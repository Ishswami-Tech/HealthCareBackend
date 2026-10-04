#!/usr/bin/env node

/**
 * One-off migration: make every PHI object in the bucket PRIVATE.
 *
 * Why: before the private-document change, patient documents were uploaded with
 * `ACL: public-read`, so every existing object under `documents/` (and any
 * `medical-records/` object written the same way) is still world-readable at its old
 * URL. The application now presigns reads (15 minute links) and uploads new files
 * private, but that does not touch the objects that already exist. This script lists
 * every key under the PHI folders and sets `ACL: private` on it.
 *
 * It is NOT run automatically and must be run once per environment (preprod first).
 *
 * Usage (from HealthCareBackend/, with the app's S3 env vars set or in .env):
 *
 *   npx tsx scripts/make-phi-objects-private.ts                    # DRY RUN (default): lists only
 *   npx tsx scripts/make-phi-objects-private.ts --apply            # really changes the ACLs
 *
 * Options:
 *   --apply                 write the ACLs (without it nothing is modified)
 *   --folders=a,b           top-level folders to process (default: documents,medical-records)
 *   --concurrency=N         ACL requests in flight at a time (default 10, max 50)
 *   --limit=N               stop after N keys (use for a trial run, e.g. --apply --limit=5)
 *
 * Environment (the same variables S3StorageService reads):
 *   S3_BUCKET (required), S3_ENDPOINT, S3_REGION, S3_PROVIDER (contabo|aws|wasabi|custom),
 *   S3_ACCESS_KEY_ID / AWS_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY / AWS_SECRET_ACCESS_KEY,
 *   S3_FORCE_PATH_STYLE (default: true unless S3_PROVIDER=aws)
 *
 * Safe to re-run: setting an already private object private is a no-op. Exit code is 1
 * when at least one key could not be updated.
 *
 * AFTER running with --apply, old `public-read` URLs stop working. Documents are served
 * through presigned URLs, so clients are unaffected, as long as every stored URL is
 * presignable. Check a few legacy documents in the app (patient "My documents" and the
 * EHR medical-records list) before running this in production.
 */

import 'dotenv/config';
import {
  ListObjectsV2Command,
  PutObjectAclCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

const DEFAULT_FOLDERS: readonly string[] = ['documents', 'medical-records'];
const DEFAULT_CONCURRENCY = 10;
const MAX_CONCURRENCY = 50;

interface Options {
  readonly apply: boolean;
  readonly folders: readonly string[];
  readonly concurrency: number;
  readonly limit: number | null;
}

interface FolderSummary {
  scanned: number;
  updated: number;
  failed: number;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(message: string): never {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(2);
}

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

function parseOptions(args: readonly string[]): Options {
  const known = ['--apply', '--folders=', '--concurrency=', '--limit='];
  const unknown = args.filter(arg => !known.some(entry => arg === entry || arg.startsWith(entry)));
  if (unknown.length > 0) {
    fail(`Unknown argument(s): ${unknown.join(' ')}`);
  }

  const foldersRaw = readFlag(args, 'folders');
  const folders = foldersRaw
    ? foldersRaw
        .split(',')
        .map(folder => folder.trim().replace(/^\/+|\/+$/g, ''))
        .filter(folder => folder.length > 0)
    : [...DEFAULT_FOLDERS];
  if (folders.length === 0 || folders.some(folder => folder.includes('..'))) {
    fail('--folders must be a comma separated list of top-level folder names');
  }

  const concurrencyRaw = readFlag(args, 'concurrency');
  const concurrency = concurrencyRaw ? Number(concurrencyRaw) : DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    fail(`--concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`);
  }

  const limitRaw = readFlag(args, 'limit');
  const limit = limitRaw ? Number(limitRaw) : null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    fail('--limit must be a positive integer');
  }

  return { apply: args.includes('--apply'), folders, concurrency, limit };
}

function buildClient(): { client: S3Client; bucket: string; endpoint: string } {
  const bucket = envValue('S3_BUCKET');
  if (!bucket) {
    fail('S3_BUCKET is not set');
  }
  const provider = envValue('S3_PROVIDER') ?? 'contabo';
  const endpoint = envValue('S3_ENDPOINT');
  const region = envValue('S3_REGION') ?? (provider === 'contabo' ? 'eu-central-1' : 'us-east-1');
  const accessKeyId = envValue('S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = envValue('S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY');
  const forcePathStyleRaw = envValue('S3_FORCE_PATH_STYLE');
  const forcePathStyle =
    forcePathStyleRaw === undefined
      ? provider !== 'aws'
      : ['true', '1', 'yes', 'on'].includes(forcePathStyleRaw.toLowerCase());

  const config: S3ClientConfig = { region, forcePathStyle };
  if (endpoint) {
    config.endpoint = endpoint;
  }
  if (accessKeyId && secretAccessKey) {
    config.credentials = { accessKeyId, secretAccessKey };
  }
  return { client: new S3Client(config), bucket, endpoint: endpoint ?? `aws:${region}` };
}

/** Every key under `prefix`, one ListObjectsV2 page (up to 1000 keys) at a time. */
async function* listKeys(
  client: S3Client,
  bucket: string,
  prefix: string
): AsyncGenerator<string[]> {
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      })
    );
    const keys = (page.Contents ?? [])
      .map(object => object.Key)
      .filter((key): key is string => typeof key === 'string' && !key.endsWith('/'));
    if (keys.length > 0) {
      yield keys;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function makePrivate(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new PutObjectAclCommand({ Bucket: bucket, Key: key, ACL: 'private' }));
    return true;
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
    process.stderr.write(`FAILED  ${key}  (${reason})\n`);
    return false;
  }
}

async function processFolder(
  client: S3Client,
  bucket: string,
  folder: string,
  options: Options,
  remaining: { count: number | null }
): Promise<FolderSummary> {
  const summary: FolderSummary = { scanned: 0, updated: 0, failed: 0 };

  for await (const pageKeys of listKeys(client, bucket, `${folder}/`)) {
    const keys =
      remaining.count === null ? pageKeys : pageKeys.slice(0, Math.max(0, remaining.count));
    if (keys.length === 0) {
      break;
    }
    summary.scanned += keys.length;
    if (remaining.count !== null) {
      remaining.count -= keys.length;
    }

    if (options.apply) {
      // Batches of `concurrency` ACL requests; the next batch starts when the last ends.
      for (let start = 0; start < keys.length; start += options.concurrency) {
        const batch = keys.slice(start, start + options.concurrency);
        const results = await Promise.all(batch.map(key => makePrivate(client, bucket, key)));
        summary.updated += results.filter(Boolean).length;
        summary.failed += results.filter(ok => !ok).length;
      }
      out(`  ${folder}/  ${summary.scanned} keys processed (${summary.failed} failed)`);
    } else {
      out(`  ${folder}/  ${summary.scanned} keys found so far`);
    }

    if (remaining.count !== null && remaining.count <= 0) {
      break;
    }
  }
  return summary;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const { client, bucket, endpoint } = buildClient();

  out(options.apply ? 'MODE: APPLY (ACLs will be changed)' : 'MODE: DRY RUN (nothing is modified)');
  out(`Bucket: ${bucket}   Endpoint: ${endpoint}`);
  out(
    `Folders: ${options.folders.join(', ')}${options.limit ? `   Limit: ${options.limit} keys` : ''}`
  );

  const remaining = { count: options.limit };
  const totals: FolderSummary = { scanned: 0, updated: 0, failed: 0 };
  for (const folder of options.folders) {
    if (remaining.count !== null && remaining.count <= 0) {
      break;
    }
    const summary = await processFolder(client, bucket, folder, options, remaining);
    totals.scanned += summary.scanned;
    totals.updated += summary.updated;
    totals.failed += summary.failed;
  }

  out('');
  if (options.apply) {
    out(
      `Done: ${totals.updated} of ${totals.scanned} objects set to private, ${totals.failed} failed.`
    );
  } else {
    out(`Dry run: ${totals.scanned} objects would be set to private.`);
    out('Re-run with --apply to change them.');
  }
  process.exitCode = totals.failed > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
});
