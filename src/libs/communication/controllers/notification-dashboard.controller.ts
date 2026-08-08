/**
 * Notification Dashboard Controller
 * ===================================
 * Serves the notification tracking dashboard HTML page
 * and exposes API endpoints for notification logs
 */

import {
  Controller,
  Get,
  Query,
  Param,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { CommunicationService } from '../communication.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { Public } from '@core/decorators/public.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { RoleEnum as Role, DeliveryStatus } from '@core/types';

@ApiTags('notification-dashboard')
@Controller('notifications')
export class NotificationDashboardController {
  constructor(
    private readonly communicationService: CommunicationService,
    private readonly databaseService: DatabaseService
  ) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Notification Tracking Dashboard',
    description:
      'Shows all email/WhatsApp/push notifications sent to users with status, delivery details, and filters.',
  })
  @ApiResponse({ status: 200, description: 'Dashboard HTML page' })
  async getNotificationDashboard(
    @Res() res: FastifyReply,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('clinicId') clinicId?: string,
    @Query('limit') limit = 50,
    @Query('skip') skip = 0
  ): Promise<unknown> {
    const acceptHeader = res.getHeader('accept') as string | undefined;
    if (acceptHeader?.includes('application/json')) {
      return this.getNotificationLogs(channel, status, userId, clinicId, limit, skip);
    }

    let initialData;
    try {
      initialData = await this.communicationService.getDeliveryLogs(
        {
          ...(channel && { channel }),
          ...(status && { status: status as DeliveryStatus }),
          ...(userId && { userId }),
          ...(clinicId && { clinicId }),
        },
        { limit: +limit, skip: +skip }
      );
    } catch {
      initialData = { logs: [], total: 0, limit: +limit, skip: +skip };
    }

    const _total = initialData.total || 0;
    const _currentLimit = initialData.limit || +limit;
    const _currentSkip = initialData.skip || +skip;
    const _baseUrl = '/notifications';

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notification Tracking Dashboard</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/gridjs@6.2.0/dist/theme/mermaid.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; color: #1a1a2e; min-height: 100vh; }
    .header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: white; padding: 1.5rem 2rem; box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    .header h1 { font-size: 1.75rem; font-weight: 700; }
    .header p { opacity: 0.7; font-size: 0.9rem; margin-top: 0.25rem; }
    .toolbar {
      background: white; padding: 1rem 2rem; display: flex; flex-wrap: wrap; gap: 0.75rem;
      align-items: center; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 10;
    }
    .filter-group { display: flex; align-items: center; gap: 0.4rem; }
    .filter-group label { font-size: 0.8rem; color: #64748b; font-weight: 600; text-transform: uppercase; }
    .filter-group select, .filter-group input {
      padding: 0.4rem 0.6rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.85rem;
      background: white; min-width: 120px;
    }
    .filter-group input { min-width: 180px; }
    .btn {
      padding: 0.4rem 1rem; border: none; border-radius: 6px; font-size: 0.85rem; cursor: pointer;
      font-weight: 600; transition: all 0.15s;
    }
    .btn-primary { background: #1a1a2e; color: white; }
    .btn-primary:hover { background: #16213e; }
    .btn-secondary { background: #e2e8f0; color: #475569; }
    .btn-secondary:hover { background: #cbd5e1; }
    .stats-bar { display: flex; gap: 1rem; padding: 1rem 2rem; flex-wrap: wrap; }
    .stat-card {
      background: white; border-radius: 10px; padding: 1rem 1.5rem; min-width: 160px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05); border-left: 4px solid;
    }
    .stat-card.total { border-left-color: #6366f1; }
    .stat-card.sent { border-left-color: #22c55e; }
    .stat-card.failed { border-left-color: #ef4444; }
    .stat-card.pending { border-left-color: #f59e0b; }
    .stat-card .label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; font-weight: 600; }
    .stat-card .value { font-size: 1.5rem; font-weight: 700; margin-top: 0.25rem; }
    .container { padding: 0 2rem 2rem; }
    .card {
      background: white; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      overflow: hidden;
    }
    .card-header { padding: 1rem 1.5rem; border-bottom: 1px solid #e2e8f0; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem 1rem; text-align: left; font-size: 0.85rem; }
    th { background: #f8fafc; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; white-space: nowrap; }
    tr { border-bottom: 1px solid #f1f5f9; }
    tr:hover { background: #f8fafc; }
    .badge {
      display: inline-flex; align-items: center; gap: 0.3rem;
      padding: 0.2rem 0.6rem; border-radius: 20px; font-size: 0.75rem; font-weight: 600;
    }
    .badge-email { background: #dbeafe; color: #1d4ed8; }
    .badge-whatsapp { background: #dcfce7; color: #15803d; }
    .badge-push { background: #fef3c7; color: #92400e; }
    .badge-sms { background: #fce7f3; color: #9d174d; }
    .badge-socket { background: #e0e7ff; color: #3730a3; }
    .status-sent { color: #22c55e; }
    .status-delivered { color: #3b82f6; }
    .status-failed { color: #ef4444; }
    .status-pending { color: #f59e0b; }
    .status-bounced { color: #ef4444; }
    .status-rejected { color: #ef4444; }
    .msg-preview { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #64748b; }
    .recipient-cell { font-weight: 500; }
    .timestamp { white-space: nowrap; color: #64748b; font-size: 0.8rem; }
    .error-cell { color: #ef4444; font-size: 0.8rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .loading { text-align: center; padding: 3rem; color: #64748b; }
    .empty-state { text-align: center; padding: 3rem; color: #94a3b8; }
    .empty-state i { font-size: 3rem; margin-bottom: 1rem; display: block; }
    .pagination { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; border-top: 1px solid #e2e8f0; }
    .pagination button { padding: 0.4rem 1rem; border: 1px solid #d1d5db; border-radius: 6px; background: white; cursor: pointer; }
    .pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
    .pagination button:hover:not(:disabled) { background: #f8fafc; }
    .pagination span { font-size: 0.85rem; color: #64748b; }
    .channel-icon { margin-right: 0.3rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1><i class="fas fa-bell" style="margin-right:0.5rem;"></i> Notification Tracking Dashboard</h1>
    <p>Track all email, WhatsApp, push, and SMS notifications sent to patients and staff</p>
  </div>
  <div class="stats-bar" id="stats"></div>
  <div class="container">
    <div class="card">
      <div class="card-header">Notification Delivery Logs</div>
      <div style="padding: 1rem 1.5rem; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; border-bottom: 1px solid #e2e8f0;">
        <div class="filter-group">
          <label>Channel</label>
          <select id="channelFilter" onchange="applyFilters()">
            <option value="">All</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="push">Push</option>
            <option value="sms">SMS</option>
            <option value="socket">Socket</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Status</label>
          <select id="statusFilter" onchange="applyFilters()">
            <option value="">All</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="bounced">Bounced</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Search</label>
          <input type="text" id="searchInput" placeholder="Search by recipient, subject, message..." onkeyup="handleSearch(event)">
        </div>
        <button class="btn btn-secondary" onclick="resetFilters()">Reset</button>
      </div>
      <div id="table-container"></div>
    </div>
  </div>
  <script>
    const ICONS = { email: 'fa-envelope', whatsapp: 'fa-whatsapp', push: 'fa-mobile-screen', sms: 'fa-comment-sms', socket: 'fa-plug' };
    function renderStats(data) {
      const total = data.total || 0;
      const byStatus = {};
      (data.logs || []).forEach(l => { byStatus[l.status] = (byStatus[l.status] || 0) + 1; });
      document.getElementById('stats').innerHTML = \`
        <div class="stat-card total"><div class="label">Total</div><div class="value">\${total.toLocaleString()}</div></div>
        <div class="stat-card sent"><div class="label">Sent</div><div class="value">\${(byStatus['sent'] || 0).toLocaleString()}</div></div>
        <div class="stat-card delivered"><div class="label">Delivered</div><div class="value">\${(byStatus['delivered'] || 0).toLocaleString()}</div></div>
        <div class="stat-card failed"><div class="label">Failed</div><div class="value">\${(byStatus['failed'] || 0).toLocaleString()}</div></div>
        <div class="stat-card pending"><div class="label">Pending</div><div class="value">\${(byStatus['pending'] || 0).toLocaleString()}</div></div>
      \`;
    }
    function renderTable(logs) {
      const container = document.getElementById('table-container');
      if (!logs.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><div>No notifications found</div></div>';
        return;
      }
      const rows = logs.map(log => {
        const n = log.notification || {};
        const recipient = n.email || n.phone || n.recipient || '-';
        const channelIcon = ICONS[log.channel] || 'fa-circle';
        const statusClass = 'status-' + (log.status || '');
        const errorText = log.failureReason || log.providerResponse || '';
        return \`<tr>
          <td><i class="fas \${channelIcon} channel-icon"></i>\${log.channel || '-'}</td>
          <td class="recipient-cell">\${escapeHtml(String(recipient))}</td>
          <td>\${escapeHtml(String(n.title || n.type || '-'))}</td>
          <td class="msg-preview" title="\${escapeHtml(String(n.message || n.body || ''))}">\${escapeHtml(String(n.message || n.body || '-'))}</td>
          <td><span class="\${statusClass}">\${(log.status || '-').toUpperCase()}</span></td>
          <td class="timestamp">\${formatDate(log.sentAt)}</td>
          <td class="timestamp">\${log.deliveredAt ? formatDate(log.deliveredAt) : '-'}</td>
          <td class="error-cell" title="\${escapeHtml(String(errorText))}">\${errorText ? escapeHtml(String(errorText)) : '-'}</td>
          <td class="timestamp">\${log.retryCount || 0}</td>
        </tr>\`;
      }).join('');
      container.innerHTML = \`
        <div style="overflow-x:auto;">
          <table>
            <thead><tr>
              <th>Channel</th><th>Recipient</th><th>Subject</th><th>Message</th>
              <th>Status</th><th>Sent At</th><th>Delivered At</th><th>Error</th><th>Retries</th>
            </tr></thead>
            <tbody>\${rows}</tbody>
          </table>
        </div>
        \${renderPagination()}
      \`;
    }
    function renderPagination() {
      const url = new URL(window.location.href);
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const skip = parseInt(url.searchParams.get('skip') || '0');
      const total = window.__total || 0;
      const hasPrev = skip > 0;
      const hasNext = skip + limit < total;
      return \`<div class="pagination">
        <button \${!hasPrev ? 'disabled' : ''} onclick="goTo(\${Math.max(0, skip - limit)})">Previous</button>
        <span>Showing \${total ? skip + 1 : 0}–\${Math.min(skip + limit, total)} of \${total}</span>
        <button \${!hasNext ? 'disabled' : ''} onclick="goTo(\${skip + limit})">Next</button>
      </div>\`;
    }
    function goTo(skip) {
      const url = new URL(window.location.href);
      url.searchParams.set('skip', String(skip));
      window.location.href = url.toString();
    }
    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function formatDate(iso) {
      if (!iso) return '-';
      try {
        const d = new Date(iso);
        return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
      } catch { return iso; }
    }
    function updateUrl(params) {
      const url = new URL(window.location.href);
      Object.entries(params).forEach(([k, v]) => { v ? url.searchParams.set(k, v) : url.searchParams.delete(k); });
      url.searchParams.set('limit', '50');
      url.searchParams.set('skip', '0');
      window.location.href = url.toString();
    }
    function applyFilters() {
      updateUrl({
        channel: document.getElementById('channelFilter').value,
        status: document.getElementById('statusFilter').value,
        search: document.getElementById('searchInput').value,
      });
    }
    function resetFilters() {
      document.getElementById('channelFilter').value = '';
      document.getElementById('statusFilter').value = '';
      document.getElementById('searchInput').value = '';
      applyFilters();
    }
    let searchTimeout;
    function handleSearch(event) {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => applyFilters(), 400);
    }
    async function loadData() {
      const url = new URL(window.location.href);
      const channel = url.searchParams.get('channel') || '';
      const status = url.searchParams.get('status') || '';
      const search = url.searchParams.get('search') || '';
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const skip = parseInt(url.searchParams.get('skip') || '0');
      document.getElementById('channelFilter').value = channel;
      document.getElementById('statusFilter').value = status;
      document.getElementById('searchInput').value = search;
      const params = new URLSearchParams({ limit: String(limit), skip: String(skip), ...(channel && { channel }), ...(status && { status }), ...(search && { search }) });
      try {
        const res = await fetch('/notifications/logs?' + params.toString(), { headers: { 'Accept': 'application/json' } });
        const data = await res.json();
        window.__total = data.total || 0;
        renderStats(data);
        renderTable(data.logs || []);
      } catch (err) {
        console.error('Failed to load notifications:', err);
        document.getElementById('table-container').innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><div>Failed to load data</div></div>';
      }
    }
    document.addEventListener('DOMContentLoaded', loadData);
  </script>
</body>
</html>
    `;

    res.header('Content-Type', 'text/html');
    return res.send(html);
  }

  @Get('logs')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('notifications', 'read')
  @ApiOperation({ summary: 'Get notification delivery logs (JSON API)' })
  @ApiQuery({ name: 'channel', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'clinicId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false })
  async getNotificationLogs(
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('clinicId') clinicId?: string,
    @Query('limit') limit = 50,
    @Query('skip') skip = 0,
    @Query('search') search?: string
  ) {
    const filter: Record<string, string | number> = {
      ...(channel && { channel }),
      ...(status && { status }),
      ...(userId && { userId }),
      ...(clinicId && { clinicId }),
    };

    let result: { logs: unknown[]; total: number; limit: number; skip: number };
    if (search) {
      const searchLower = search.toLowerCase();
      result = await this.communicationService.getDeliveryLogs(filter, { limit: 200, skip: 0 });
      result.logs = (result.logs as Record<string, unknown>[]).filter(log => {
        const n = (log['notification'] || {}) as Record<string, unknown>;
        const searchStr = [
          n['message'], n['title'], n['body'], n['email'], n['phone'],
          n['recipient'], log['channel'], log['status'], log['failureReason'], n['type'],
        ].filter(Boolean).join(' ').toLowerCase();
        return searchStr.includes(searchLower);
      });
      result.limit = +limit;
      result.skip = +skip;
      result.logs = result.logs.slice(+skip, +skip + +limit);
    } else {
      result = await this.communicationService.getDeliveryLogs(filter, { limit: +limit, skip: +skip });
    }

    return result;
  }

  @Get('logs/:id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('notifications', 'read')
  @ApiOperation({ summary: 'Get notification delivery log by ID' })
  async getNotificationLogById(@Param('id') id: string) {
    return this.communicationService.getDeliveryLogById(id);
  }

  @Get('stats')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('notifications', 'read')
  @ApiOperation({ summary: 'Get notification summary statistics' })
  async getNotificationStats() {
    return this.databaseService.executeHealthcareRead(async prisma => {
      const client = prisma as unknown as {
        notificationDeliveryLog: {
          count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
          groupBy: (args: { by: string[]; where?: Record<string, unknown> }) => Promise<Array<Record<string, unknown>>>;
        };
        notification: {
          count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
        };
      };

      const [totalNotifications, totalLogs, byChannel, byStatus] = await Promise.all([
        client.notification.count(),
        client.notificationDeliveryLog.count(),
        client.notificationDeliveryLog.groupBy({ by: ['channel'] }),
        client.notificationDeliveryLog.groupBy({ by: ['status'] }),
      ]);

      const channelMap: Record<string, number> = {};
      for (const item of byChannel) {
        const ch = item['channel'] as string;
        if (ch) channelMap[ch] = (item['_count'] as Record<string, number>)['channel'] || 0;
      }

      const statusMap: Record<string, number> = {};
      for (const item of byStatus) {
        const s = item['status'] as string;
        if (s) statusMap[s] = (item['_count'] as Record<string, number>)?.[s] || 0;
      }

      return { totalNotifications, totalLogs, byChannel: channelMap, byStatus: statusMap };
    });
  }
}
