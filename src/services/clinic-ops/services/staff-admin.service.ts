/**
 * Staff Admin Service (clinic admin)
 * @module ClinicOps
 * @description Staff invitations (invite by phone / email, resend, revoke) and a staff detail view
 * (profile, today's status, leave). Account creation from an invite is completed by the auth flow:
 * the invitee opens the link, verifies their phone and the account is attached to the clinic with
 * the invited role.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { EventService } from '@infrastructure/events/event.service';
import { OpsDbService, type OpsActor } from './ops-db.service';
import { ClinicAuditService } from './audit.service';
import { assertLocationsInClinic } from './clinic-scope.util';
import { addDays, displayName, startOfUtcDay, type StaffInviteRow } from '../clinic-ops.types';
import { pickStaffLocation, staffLocationSelect } from '@utils/staff-location.util';
import type { CreateStaffInviteDto } from '../dto/clinic-ops.dto';
import {
  dedupeByUserId,
  phoneLookupVariants,
  staffDirectoryWhere,
  staffMembershipWhere,
} from './staff-membership.util';

const INVITE_TTL_DAYS = 7;
const STAFF_ROLES = [
  'DOCTOR',
  'ASSISTANT_DOCTOR',
  'RECEPTIONIST',
  'PHARMACIST',
  'NURSE',
  'THERAPIST',
  'CLINIC_ADMIN',
];

export interface StaffInviteResponse {
  id: string;
  role: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  locationIds: string[];
  status: string;
  expiresAt: string;
  lastSentAt: string | null;
  resendCount: number;
  createdAt: string;
  /** Only on create / resend: the one-time link token. Never stored in clear text. */
  inviteToken?: string;
  inviteLinkPath?: string;
}

export interface StaffMemberResponse {
  userId: string;
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  lastLogin: string | null;
  onLeaveToday: boolean;
  /** The clinic location the member is allotted to (staff profile); null when unassigned. */
  locationId: string | null;
  locationName: string | null;
}

export interface StaffMemberDetailResponse extends StaffMemberResponse {
  joinedAt: string | null;
  pendingLeaveRequests: number;
  upcomingLeave: Array<{
    id: string;
    kind: string;
    startDate: string;
    endDate: string;
    status: string;
  }>;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class StaffAdminService {
  constructor(
    private readonly ops: OpsDbService,
    private readonly eventService: EventService,
    private readonly audit: ClinicAuditService
  ) {}

  // ------------------------------------------------------------------ invites

  async createInvite(
    dto: CreateStaffInviteDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<StaffInviteResponse> {
    if (!dto.phone && !dto.email) {
      throw new BadRequestException('Enter a phone number or an email to invite');
    }
    const locationIds = dto.locationIds ?? [];
    await this.ops.read(client => assertLocationsInClinic(client, locationIds, clinicId));
    const duplicate = await this.ops.read(client =>
      client.staffInvite.findFirst({
        where: {
          clinicId,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
          OR: [
            ...(dto.phone ? [{ phone: dto.phone }] : []),
            ...(dto.email ? [{ email: dto.email.toLowerCase() }] : []),
          ],
        },
      })
    );
    if (duplicate) {
      throw new ConflictException('There is already a pending invitation for this contact');
    }
    await this.assertNotRegisteredStaff(dto, clinicId);
    const token = randomBytes(24).toString('hex');
    const row = await this.ops.write(
      client =>
        client.staffInvite.create({
          data: {
            clinicId,
            role: dto.role,
            name: dto.name?.trim() || null,
            phone: dto.phone ?? null,
            email: dto.email ? dto.email.toLowerCase() : null,
            locationIds,
            tokenHash: hashToken(token),
            invitedById: actor.userId,
            expiresAt: addDays(new Date(), INVITE_TTL_DAYS),
            lastSentAt: new Date(),
          },
        }),
      {
        actor,
        clinicId,
        resourceType: 'STAFF_INVITE',
        operation: 'CREATE',
        details: { role: dto.role },
      }
    );
    await this.emitSent(row, token, clinicId);
    return this.toInvite(row, token);
  }

  async listInvites(clinicId: string, status?: string): Promise<StaffInviteResponse[]> {
    const rows = await this.ops.read(client =>
      client.staffInvite.findMany({
        where: { clinicId, ...(status ? { status: status.toUpperCase() } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
    );
    const now = Date.now();
    return rows.map(r =>
      this.toInvite(
        r.status === 'PENDING' && r.expiresAt.getTime() < now ? { ...r, status: 'EXPIRED' } : r
      )
    );
  }

  async resendInvite(id: string, clinicId: string, actor: OpsActor): Promise<StaffInviteResponse> {
    const invite = await this.findInvite(id, clinicId);
    if (!['PENDING', 'EXPIRED'].includes(invite.status)) {
      throw new BadRequestException(`A ${invite.status.toLowerCase()} invitation cannot be resent`);
    }
    const token = randomBytes(24).toString('hex');
    const row = await this.ops.write(
      async client => {
        await client.staffInvite.updateMany({
          where: { id, clinicId, status: { in: ['PENDING', 'EXPIRED'] } },
          data: {
            status: 'PENDING',
            tokenHash: hashToken(token),
            expiresAt: addDays(new Date(), INVITE_TTL_DAYS),
            lastSentAt: new Date(),
            resendCount: invite.resendCount + 1,
          },
        });
        return (await client.staffInvite.findFirst({ where: { id } })) as StaffInviteRow;
      },
      { actor, clinicId, resourceType: 'STAFF_INVITE', operation: 'RESEND', resourceId: id }
    );
    await this.emitSent(row, token, clinicId);
    return this.toInvite(row, token);
  }

  async revokeInvite(id: string, clinicId: string, actor: OpsActor): Promise<StaffInviteResponse> {
    const invite = await this.findInvite(id, clinicId);
    if (invite.status === 'ACCEPTED') {
      throw new ConflictException('This invitation was already accepted');
    }
    if (invite.status === 'REVOKED') {
      throw new ConflictException('This invitation was already revoked');
    }
    const row = await this.ops.write(
      async client => {
        await client.staffInvite.updateMany({
          where: { id, clinicId, status: { in: ['PENDING', 'EXPIRED'] } },
          data: { status: 'REVOKED' },
        });
        return (await client.staffInvite.findFirst({ where: { id } })) as StaffInviteRow;
      },
      { actor, clinicId, resourceType: 'STAFF_INVITE', operation: 'REVOKE', resourceId: id }
    );
    return this.toInvite(row);
  }

  // ------------------------------------------------------------------ members

  async listMembers(
    clinicId: string,
    filter: { role?: string; q?: string }
  ): Promise<StaffMemberResponse[]> {
    const role = filter.role?.toUpperCase();
    if (role && !STAFF_ROLES.includes(role)) {
      throw new BadRequestException('Unknown staff role');
    }
    // Staff are linked to the clinic through the join table, their role table, coverage, a
    // clinic-scoped UserRole or primaryClinicId (staff-membership.util); listed once each.
    const where = staffDirectoryWhere(clinicId, STAFF_ROLES, {
      ...filter,
      ...(role ? { role } : {}),
    });
    const found = await this.ops.read(client =>
      client.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          role: true,
          isActive: true,
          lastLogin: true,
          ...staffLocationSelect(clinicId),
        },
        orderBy: { name: 'asc' },
        take: 300,
      })
    );
    const users = dedupeByUserId(found);
    const onLeave = await this.onLeaveToday(
      clinicId,
      users.map(u => u.id)
    );
    return users.map(u => ({
      userId: u.id,
      name: displayName(u),
      role: String(u.role),
      phone: u.phone,
      email: u.email,
      isActive: u.isActive !== false,
      lastLogin: u.lastLogin ? u.lastLogin.toISOString() : null,
      onLeaveToday: onLeave.has(u.id),
      ...pickStaffLocation(u as unknown as Record<string, unknown>, String(u.role)),
    }));
  }

  async getMember(userId: string, clinicId: string): Promise<StaffMemberDetailResponse> {
    const user = await this.ops.read(client =>
      client.user.findFirst({
        where: { AND: [{ id: userId, role: { in: STAFF_ROLES } }, staffMembershipWhere(clinicId)] },
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          role: true,
          isActive: true,
          lastLogin: true,
          createdAt: true,
          ...staffLocationSelect(clinicId),
        },
      })
    );
    if (!user) throw new NotFoundException('Staff member not found');
    const today = startOfUtcDay(new Date());
    const [leave, pending, onLeave] = await Promise.all([
      this.ops.read(client =>
        client.leaveRequest.findMany({
          where: {
            clinicId,
            userId,
            status: { in: ['APPROVED', 'PENDING'] },
            endDate: { gte: today },
          },
          orderBy: { startDate: 'asc' },
          take: 10,
        })
      ),
      this.ops.read(client =>
        client.leaveRequest.count({ where: { clinicId, userId, status: 'PENDING' } })
      ),
      this.onLeaveToday(clinicId, [userId]),
    ]);
    return {
      userId: user.id,
      name: displayName(user),
      role: String(user.role),
      phone: user.phone,
      email: user.email,
      isActive: user.isActive !== false,
      lastLogin: user.lastLogin ? user.lastLogin.toISOString() : null,
      onLeaveToday: onLeave.has(userId),
      ...pickStaffLocation(user as unknown as Record<string, unknown>, String(user.role)),
      joinedAt: user.createdAt ? user.createdAt.toISOString() : null,
      pendingLeaveRequests: pending,
      upcomingLeave: leave.map(l => ({
        id: l.id,
        kind: l.kind,
        startDate: l.startDate.toISOString().slice(0, 10),
        endDate: l.endDate.toISOString().slice(0, 10),
        status: l.status,
      })),
    };
  }

  // ------------------------------------------------------------------ helpers

  /**
   * An invite is for someone without a staff account: a phone / email that already belongs to a
   * staff user (of this clinic, or of another one, whose account the invite would take over) is
   * a 409 rather than a second, conflicting account.
   */
  private async assertNotRegisteredStaff(
    dto: CreateStaffInviteDto,
    clinicId: string
  ): Promise<void> {
    const contact = [
      ...(dto.phone ? [{ phone: { in: phoneLookupVariants(dto.phone) } }] : []),
      ...(dto.email ? [{ email: { equals: dto.email.trim(), mode: 'insensitive' } }] : []),
    ];
    if (contact.length === 0) return;
    const existing = await this.ops.read(client =>
      client.user.findFirst({
        where: { OR: contact, role: { in: STAFF_ROLES }, deletedAt: null },
        select: { id: true },
      })
    );
    if (!existing) return;
    const member = await this.ops.read(client =>
      client.user.findFirst({
        where: { AND: [{ id: existing.id }, staffMembershipWhere(clinicId)] },
        select: { id: true },
      })
    );
    throw new ConflictException(
      member
        ? 'This person is already on your staff'
        : 'This phone or email already belongs to a staff account at another clinic'
    );
  }

  private async onLeaveToday(clinicId: string, userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const today = startOfUtcDay(new Date());
    const rows = await this.ops.read(client =>
      client.leaveRequest.findMany({
        where: {
          clinicId,
          userId: { in: userIds },
          status: 'APPROVED',
          startDate: { lte: today },
          endDate: { gte: today },
        },
        select: { userId: true },
      })
    );
    return new Set(rows.map(r => r.userId));
  }

  private async findInvite(id: string, clinicId: string): Promise<StaffInviteRow> {
    const invite = await this.ops.read(client =>
      client.staffInvite.findFirst({ where: { id, clinicId } })
    );
    if (!invite) throw new NotFoundException('Invitation not found');
    return invite;
  }

  private async emitSent(row: StaffInviteRow, token: string, clinicId: string): Promise<void> {
    // The communication layer delivers the link by WhatsApp / SMS / email.
    await this.eventService.emit('clinic-ops.staff-invite.sent', {
      inviteId: row.id,
      clinicId,
      role: row.role,
      name: row.name,
      phone: row.phone,
      email: row.email,
      inviteLinkPath: `/invite/${token}`,
      expiresAt: row.expiresAt.toISOString(),
    });
  }

  private toInvite(row: StaffInviteRow, token?: string): StaffInviteResponse {
    return {
      id: row.id,
      role: row.role,
      name: row.name,
      phone: row.phone,
      email: row.email,
      locationIds: row.locationIds,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      lastSentAt: row.lastSentAt ? row.lastSentAt.toISOString() : null,
      resendCount: row.resendCount,
      createdAt: row.createdAt.toISOString(),
      ...(token ? { inviteToken: token, inviteLinkPath: `/invite/${token}` } : {}),
    };
  }
}
