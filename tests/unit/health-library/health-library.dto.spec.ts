/// <reference types="jest" />

/**
 * DTO validation tests for the Health Library: explicit-null PATCH handling,
 * whitespace trimming, https-only URLs and the removal of client-set covers.
 *
 * Validation mirrors the app-wide ValidationPipe options
 * (transform + whitelist + forbidNonWhitelisted).
 */

import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateHealthLibraryPostDto, UpdateHealthLibraryPostDto } from '@dtos/health-library.dto';

interface ValidationOutcome<T extends object> {
  instance: T;
  /** Top-level property names that failed validation. */
  failed: string[];
}

async function check<T extends object>(
  dto: ClassConstructor<T>,
  body: object
): Promise<ValidationOutcome<T>> {
  const instance = plainToInstance(dto, body);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return { instance, failed: errors.map(error => error.property) };
}

const VALID_CREATE = {
  tab: 'ARTICLES',
  title: 'Sleep better',
  category: 'Sleep',
  summary: 'Habits that help you rest.',
};

const GOOD_VIDEO_URLS = [
  'https://www.youtube.com/watch?v=abc123',
  'https://youtu.be/abc123',
  'https://vimeo.com/123456',
  'https://cdn.example.com/videos/intro.mp4',
];

const BAD_VIDEO_URLS = [
  ['plain http', 'http://www.youtube.com/watch?v=abc123'],
  ['ftp', 'ftp://example.com/video.mp4'],
  ['javascript scheme', 'javascript:alert(1)'],
  ['data scheme', 'data:text/html;base64,PHNjcmlwdD4='],
  ['protocol-relative', '//example.com/video.mp4'],
  ['no protocol', 'www.youtube.com/watch?v=abc123'],
  ['no TLD', 'https://localhost/video.mp4'],
  ['relative path', '/storage/assets/video.mp4'],
  ['over 500 characters', `https://example.com/${'a'.repeat(500)}`],
  ['an empty string', ''],
] as const;

describe('CreateHealthLibraryPostDto', () => {
  it('accepts a minimal valid payload', async () => {
    const { failed } = await check(CreateHealthLibraryPostDto, VALID_CREATE);

    expect(failed).toEqual([]);
  });

  it.each(['title', 'category', 'summary'] as const)(
    'rejects a whitespace-only %s',
    async field => {
      const { failed } = await check(CreateHealthLibraryPostDto, {
        ...VALID_CREATE,
        [field]: '   \t  ',
      });

      expect(failed).toContain(field);
    }
  );

  it('trims surrounding whitespace from text fields', async () => {
    const { instance, failed } = await check(CreateHealthLibraryPostDto, {
      ...VALID_CREATE,
      title: '  Sleep better  ',
      readTime: ' 5 min read ',
      whenToSeeDoctor: '  Call 112  ',
      sections: [{ heading: '  Routine ', body: ' Same bedtime. ' }],
    });

    expect(failed).toEqual([]);
    expect(instance.title).toBe('Sleep better');
    expect(instance.readTime).toBe('5 min read');
    expect(instance.whenToSeeDoctor).toBe('Call 112');
    expect(instance.sections).toEqual([{ heading: 'Routine', body: 'Same bedtime.' }]);
  });

  it('rejects sections whose heading or body is whitespace-only', async () => {
    const blankHeading = await check(CreateHealthLibraryPostDto, {
      ...VALID_CREATE,
      sections: [{ heading: '   ', body: 'Body' }],
    });
    const blankBody = await check(CreateHealthLibraryPostDto, {
      ...VALID_CREATE,
      sections: [{ heading: 'Heading', body: '   ' }],
    });

    expect(blankHeading.failed).toContain('sections');
    expect(blankBody.failed).toContain('sections');
  });

  it.each(GOOD_VIDEO_URLS)('accepts the https video URL %s', async videoUrl => {
    const { failed } = await check(CreateHealthLibraryPostDto, {
      ...VALID_CREATE,
      mediaType: 'VIDEO',
      videoUrl,
    });

    expect(failed).toEqual([]);
  });

  it.each(BAD_VIDEO_URLS)('rejects a video URL that is %s', async (_label, videoUrl) => {
    const { failed } = await check(CreateHealthLibraryPostDto, {
      ...VALID_CREATE,
      mediaType: 'VIDEO',
      videoUrl,
    });

    expect(failed).toContain('videoUrl');
  });

  it('no longer accepts coverImageUrl or coverImageKey (covers are upload-only)', async () => {
    const withUrl = await check(CreateHealthLibraryPostDto, {
      ...VALID_CREATE,
      coverImageUrl: 'https://cdn.example.com/cover.jpg',
    });
    const withKey = await check(CreateHealthLibraryPostDto, {
      ...VALID_CREATE,
      coverImageKey: 'library-covers/cover.jpg',
    });

    expect(withUrl.failed).toContain('coverImageUrl');
    expect(withKey.failed).toContain('coverImageKey');
  });

  it('still rejects an unknown tab or media type', async () => {
    const { failed } = await check(CreateHealthLibraryPostDto, {
      ...VALID_CREATE,
      tab: 'NEWS',
      mediaType: 'PODCAST',
    });

    expect(failed).toEqual(expect.arrayContaining(['tab', 'mediaType']));
  });
});

describe('UpdateHealthLibraryPostDto', () => {
  it('accepts an empty patch (every field optional)', async () => {
    const { failed } = await check(UpdateHealthLibraryPostDto, {});

    expect(failed).toEqual([]);
  });

  it.each(['tab', 'mediaType', 'title', 'category', 'summary', 'sections'] as const)(
    'rejects an explicit null %s',
    async field => {
      const { failed } = await check(UpdateHealthLibraryPostDto, { [field]: null });

      expect(failed).toContain(field);
    }
  );

  it('accepts null for the genuinely clearable fields', async () => {
    const { failed } = await check(UpdateHealthLibraryPostDto, {
      readTime: null,
      videoUrl: null,
      videoDurationSeconds: null,
      whenToSeeDoctor: null,
    });

    expect(failed).toEqual([]);
  });

  it.each(['title', 'category', 'summary'] as const)(
    'rejects an empty or whitespace-only %s',
    async field => {
      const empty = await check(UpdateHealthLibraryPostDto, { [field]: '' });
      const blank = await check(UpdateHealthLibraryPostDto, { [field]: '   ' });

      expect(empty.failed).toContain(field);
      expect(blank.failed).toContain(field);
    }
  );

  it('applies the same https-only URL rule to videoUrl', async () => {
    for (const [, videoUrl] of BAD_VIDEO_URLS) {
      const { failed } = await check(UpdateHealthLibraryPostDto, { videoUrl });
      expect(failed).toContain('videoUrl');
    }
    for (const videoUrl of GOOD_VIDEO_URLS) {
      const { failed } = await check(UpdateHealthLibraryPostDto, { videoUrl });
      expect(failed).toEqual([]);
    }
  });

  it('rejects coverImageUrl and coverImageKey', async () => {
    const { failed } = await check(UpdateHealthLibraryPostDto, {
      coverImageUrl: 'https://cdn.example.com/cover.jpg',
      coverImageKey: 'library-covers/cover.jpg',
    });

    expect(failed).toEqual(expect.arrayContaining(['coverImageUrl', 'coverImageKey']));
  });

  it('accepts [] to clear sections and trims their text', async () => {
    const cleared = await check(UpdateHealthLibraryPostDto, { sections: [] });
    const trimmed = await check(UpdateHealthLibraryPostDto, {
      sections: [{ heading: ' H ', body: ' B ' }],
    });

    expect(cleared.failed).toEqual([]);
    expect(trimmed.failed).toEqual([]);
    expect(trimmed.instance.sections).toEqual([{ heading: 'H', body: 'B' }]);
  });
});

describe('ValidationPipe (as configured app-wide)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it('turns PATCH {"title": null} into a 400 instead of reaching the service', async () => {
    await expect(
      pipe.transform({ title: null }, { type: 'body', metatype: UpdateHealthLibraryPostDto })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets a valid partial PATCH through, with text trimmed', async () => {
    const result = (await pipe.transform(
      { title: '  New title  ' },
      { type: 'body', metatype: UpdateHealthLibraryPostDto }
    )) as UpdateHealthLibraryPostDto;

    expect(result.title).toBe('New title');
  });

  it('rejects a body that tries to set coverImageUrl', async () => {
    await expect(
      pipe.transform(
        { ...VALID_CREATE, coverImageUrl: 'https://cdn.example.com/cover.jpg' },
        { type: 'body', metatype: CreateHealthLibraryPostDto }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
