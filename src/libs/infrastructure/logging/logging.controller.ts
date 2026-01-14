// External imports
import {
  Controller,
  Get,
  Query,
  Res,
  Post,
  Body,
  Param,
  Inject,
  forwardRef,
  VERSION_NEUTRAL,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

// Internal imports - Infrastructure
import { LoggingService } from '@logging';

// Internal imports - Types
import { LogType, LogLevel } from '@core/types';

// Internal imports - DTOs
import {
  GetLogsQueryDto,
  GetEventsQueryDto,
  ClearLogsDto,
  PaginatedLogsResponseDto,
  PaginatedEventsResponseDto,
} from '@dtos/logging.dto';

// Internal imports - Rate Limiting
import { RateLimitAPI } from '@security/rate-limit/rate-limit.decorator';

@ApiTags('logging')
@Controller({ path: 'logger', version: VERSION_NEUTRAL })
export class LoggingController {
  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  private getHtmlTemplate(activeTab: 'logs' | 'events' = 'logs'): string {
    return `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Logging Dashboard</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 20px; }
        h1 { margin: 0 0 20px; color: #333; text-align: center; }
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; justify-content: center; }
        .tab { padding: 10px 20px; cursor: pointer; border: none; background: #f0f0f0; border-radius: 4px; font-size: 14px; text-decoration: none; color: #333; }
        .tab.active { background: #2196F3; color: white; }
        .controls { display: flex; gap: 10px; margin-bottom: 20px; justify-content: center; align-items: center; flex-wrap: wrap; }
        select { padding: 8px; border: 1px solid #ddd; border-radius: 4px; min-width: 150px; }
        button { padding: 8px 16px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        button.danger { background: #dc3545; }
        button.danger:hover { background: #c82333; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .entry { background: #fff; border: 1px solid #eee; border-radius: 4px; padding: 15px; margin-bottom: 10px; }
        .timestamp { color: #666; font-size: 12px; }
        .level { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 12px; margin-left: 8px; }
        .level.INFO { background: #E3F2FD; color: #1976D2; }
        .level.WARN { background: #FFF3E0; color: #F57C00; }
        .level.ERROR { background: #FFEBEE; color: #D32F2F; }
        .level.DEBUG { background: #E8F5E9; color: #388E3C; }
        .type { display: inline-block; padding: 2px 6px; background: #f0f0f0; border-radius: 3px; font-size: 12px; margin-left: 8px; }
        .message { margin: 10px 0; }
        .metadata { background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 12px; white-space: pre-wrap; }
        .empty-state { text-align: center; padding: 40px; color: #666; }
        .refresh-status { font-size: 12px; color: #666; margin-left: 10px; }
        .button-group { display: flex; gap: 10px; }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .loading {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid #f3f3f3;
          border-top: 2px solid #2196F3;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-right: 8px;
          vertical-align: middle;
        }
        .filters {
          margin: 10px 0;
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .time-range {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .entry {
          background: #f5f5f5;
          padding: 10px;
          margin: 5px 0;
          border-radius: 4px;
        }
        .entry .timestamp {
          color: #666;
          font-size: 0.9em;
        }
        .entry .level {
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 0.9em;
          font-weight: bold;
        }
        .entry .level.ERROR { background: #ffebee; color: #d32f2f; }
        .entry .level.WARN { background: #fff3e0; color: #f57c00; }
        .entry .level.INFO { background: #e8f5e9; color: #388e3c; }
        .entry .level.DEBUG { background: #e3f2fd; color: #1976d2; }
        .entry .type {
          font-weight: bold;
          margin-left: 10px;
        }
        .entry .message {
          margin: 5px 0;
          font-family: monospace;
        }
        .entry .metadata {
          font-family: monospace;
          font-size: 0.9em;
          color: #666;
          white-space: pre-wrap;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Logging Dashboard</h1>
        <div class="tabs">
          <button class="tab ${activeTab === 'logs' ? 'active' : ''}" onclick="switchTab('logs')">Logs</button>
          <button class="tab ${activeTab === 'events' ? 'active' : ''}" onclick="switchTab('events')">Events</button>
        </div>
        
        <div id="logsPanel" style="display: ${activeTab === 'logs' ? 'block' : 'none'}">
          <div class="filters">
            <select id="logType">
              <option value="">All Types</option>
              <option value="SYSTEM">System</option>
              <option value="AUTH">Auth</option>
              <option value="ERROR">Error</option>
              <option value="REQUEST">Request</option>
              <option value="RESPONSE">Response</option>
              <option value="DATABASE">Database</option>
              <option value="CACHE">Cache</option>
              <option value="QUEUE">Queue</option>
              <option value="EMAIL">Email</option>
              <option value="AUDIT">Audit</option>
            </select>
            <select id="logLevel">
              <option value="">All Levels</option>
              <option value="ERROR">Error</option>
              <option value="WARN">Warning</option>
              <option value="INFO">Info</option>
              <option value="DEBUG">Debug</option>
            </select>
            <div class="time-range">
              <select id="timeRange" onchange="handleTimeRangeChange()">
                <option value="1">Last 1 hour</option>
                <option value="6">Last 6 hours</option>
                <option value="12">Last 12 hours</option>
                <option value="24">Last 24 hours</option>
                <option value="168">Last 7 days</option>
                <option value="720">Last 30 days</option>
                <option value="all" selected>All Time (from cache)</option>
                <option value="custom">Custom Range</option>
              </select>
              <div id="customRange" style="display: none;">
                <input type="datetime-local" id="startTime" />
                <input type="datetime-local" id="endTime" />
              </div>
            </div>
            <input type="text" id="searchInput" placeholder="Search logs..." style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; min-width: 200px;" />
            <button id="refreshButton" onclick="manualRefresh()">Refresh</button>
            <button onclick="clearLogs()">Clear Logs</button>
            <span id="refreshStatus"></span>
          </div>
          <div id="logsContent"></div>
        </div>
        
        <div id="eventsPanel" style="display: ${activeTab === 'events' ? 'block' : 'none'}">
          <div class="controls">
            <select id="eventType">
              <option value="">All Types</option>
              <option value="user.loggedIn">User Logged In</option>
              <option value="user.registered">User Registered</option>
              <option value="clinic.created">Clinic Created</option>
              <option value="clinic.updated">Clinic Updated</option>
              <option value="clinic.deleted">Clinic Deleted</option>
            </select>
            <div class="button-group">
              <button id="eventRefreshButton" onclick="manualRefresh()">Refresh</button>
              <button id="clearEventsButton" class="danger" onclick="clearEvents()">Clear Events</button>
            </div>
            <span id="eventRefreshStatus" class="refresh-status"></span>
          </div>
          <div id="eventsContent"></div>
        </div>
      </div>
      
      <script>
        let currentTab = '${activeTab}';
        let refreshInterval;
        let isRefreshing = false;
        let lastRefreshTime = new Date();
        const REFRESH_INTERVAL = 30000; // 30 seconds instead of 5 seconds
        let failedAttempts = 0;
        const MAX_FAILED_ATTEMPTS = 3;

        function updateRefreshStatus(isLoading, error = null) {
          const statusElement = document.getElementById(currentTab === 'logs' ? 'refreshStatus' : 'eventRefreshStatus');
          const refreshButton = document.getElementById(currentTab === 'logs' ? 'refreshButton' : 'eventRefreshButton');
          
          if (error) {
            statusElement.innerHTML = '<span style="color: red;">Error: ' + error + '</span>';
            refreshButton.disabled = false;
            return;
          }
          
          if (isLoading) {
            statusElement.innerHTML = '<span class="loading"></span>Refreshing...';
            refreshButton.disabled = true;
          } else {
            lastRefreshTime = new Date();
            const timeString = lastRefreshTime.toLocaleTimeString();
            statusElement.innerHTML = 'Last updated: ' + timeString;
            refreshButton.disabled = false;
          }
        }

        async function clearLogs() {
          if (!confirm('Are you sure you want to clear all logs?')) return;
          
          try {
            const response = await fetch('/logger/logs/clear', { method: 'POST' });
            if (!response.ok) {
              throw new Error('Failed to clear logs: ' + response.statusText);
            }
            refreshContent();
          } catch (error) {
            console.error('Error clearing logs:', error);
            alert('Failed to clear logs');
          }
        }

        async function clearEvents() {
          if (!confirm('Are you sure you want to clear all events?')) return;
          
          try {
            const response = await fetch('/logger/events/clear', { method: 'POST' });
            if (!response.ok) {
              throw new Error('Failed to clear events: ' + response.statusText);
            }
            refreshContent();
          } catch (error) {
            console.error('Error clearing events:', error);
            alert('Failed to clear events');
          }
        }

        function handleTimeRangeChange() {
          const range = document.getElementById('timeRange').value;
          const customRange = document.getElementById('customRange');
          customRange.style.display = range === 'custom' ? 'block' : 'none';
          
          if (range !== 'custom') {
            refreshContent();
          }
        }

        async function refreshContent(manual = false) {
          if (isRefreshing) return;
          
          try {
            isRefreshing = true;
            updateRefreshStatus(true);
            
            const contentId = currentTab === 'logs' ? 'logsContent' : 'eventsContent';
            const container = document.getElementById(contentId);
            
            let url = '/logger/' + currentTab + '/data';
            const params = new URLSearchParams();
            
            // Set high limit to show ALL logs from cache (up to 10000 to match cache size)
            // This ensures all logs appear in the UI, not just the first 100
            params.append('limit', '10000');
            params.append('page', '1');
            
            if (currentTab === 'logs') {
              const type = document.getElementById('logType').value;
              const level = document.getElementById('logLevel').value;
              const timeRange = document.getElementById('timeRange').value;
              const searchInput = document.getElementById('searchInput') as HTMLInputElement;
              const search = searchInput?.value?.trim();
              
              if (type) params.append('type', type);
              if (level) params.append('level', level);
              if (search) params.append('search', search);
              
              if (timeRange === 'custom') {
                const startTime = document.getElementById('startTime') as HTMLInputElement;
                const endTime = document.getElementById('endTime') as HTMLInputElement;
                if (startTime?.value) params.append('startTime', new Date(startTime.value).toISOString());
                if (endTime?.value) params.append('endTime', new Date(endTime.value).toISOString());
              } else if (timeRange === 'all') {
                // Don't add time filters - show all logs from cache
                // This allows viewing all available logs regardless of time
              } else {
                const hours = parseInt(timeRange);
                const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
                params.append('startTime', startTime.toISOString());
              }
            } else {
              const type = document.getElementById('eventType').value;
              if (type) params.append('type', type);
            }
            
            // Always append params (limit and page are always set)
            url += '?' + params.toString();

            const response = await fetch(url);
            if (!response.ok) {
              throw new Error('Failed to fetch data: ' + response.statusText);
            }
            
            const data = await response.json();
            
            // Handle paginated response format: { logs: [], meta: {} } or { events: [], meta: {} }
            const items = currentTab === 'logs' 
              ? (data.logs || (Array.isArray(data) ? data : []))
              : (data.events || (Array.isArray(data) ? data : []));
            const meta = data.meta || {};
            
            if (!items || items.length === 0) {
              const emptyMessage = currentTab === 'logs' 
                ? 'No logs found. Logs will appear here as they are generated by the system.'
                : 'No events found. Events will appear here as they are generated by the system.';
              container.innerHTML = '<div class="empty-state">' + emptyMessage + '</div>';
              failedAttempts = 0;
              updateRefreshStatus(false);
              return;
            }

            // Show total count and pagination info if available
            const itemType = currentTab === 'logs' ? 'logs' : 'events';
            const moreInfo = meta.hasNext ? ' (more available - increase limit to see all)' : ' (all ' + itemType + ' shown)';
            const itemsCount = items.length;
            const totalCount = meta.total || 0;
            const totalInfoHtml = '<div style="margin-bottom: 10px; padding: 10px; background: #f0f0f0; border-radius: 4px; color: #666; font-size: 0.9em;"><strong>Showing ' + itemsCount + ' of ' + totalCount + ' ' + itemType + '</strong>' + moreInfo + '</div>';
            const totalInfo = meta.total ? totalInfoHtml : '';
            
            // Render logs or events based on current tab
            if (currentTab === 'logs') {
              container.innerHTML = totalInfo + items.map(log => {
                const metadata = typeof (log as { metadata?: unknown }).metadata === 'string' ? JSON.parse((log as { metadata?: unknown }).metadata) : (log as { metadata?: unknown }).metadata;
                return '<div class="entry">' +
                  '<span class="timestamp">' + new Date(log.timestamp).toLocaleString() + '</span>' +
                  '<span class="level ' + log.level + '">' + log.level + '</span>' +
                  '<span class="type">' + log.type + '</span>' +
                  '<div class="message">' + log.message + '</div>' +
                  '<div class="metadata">' + JSON.stringify(metadata, null, 2) + '</div>' +
                  '</div>';
              }).join('');
            } else {
              // Render events
              container.innerHTML = totalInfo + items.map(event => {
                const eventData = typeof (event as { data?: unknown }).data === 'string' 
                  ? JSON.parse((event as { data?: unknown }).data as string) 
                  : (event as { data?: unknown }).data;
                return '<div class="entry">' +
                  '<span class="timestamp">' + new Date(event.timestamp).toLocaleString() + '</span>' +
                  '<span class="type">' + event.type + '</span>' +
                  '<div class="message">Event: ' + event.type + '</div>' +
                  '<div class="metadata">' + JSON.stringify(eventData, null, 2) + '</div>' +
                  '</div>';
              }).join('');
            }
            
            failedAttempts = 0;
            updateRefreshStatus(false);
            
          } catch (error) {
            console.error('Error refreshing content:', error);
            failedAttempts++;
            
            if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
              clearInterval(refreshInterval);
              updateRefreshStatus(false, 'Auto-refresh stopped due to errors. Click Refresh to try again.');
            } else {
              updateRefreshStatus(false, (error as Error).message);
            }
          } finally {
            isRefreshing = false;
          }
        }

        function startAutoRefresh() {
          if (refreshInterval) {
            clearInterval(refreshInterval);
          }
          refreshInterval = setInterval(refreshContent, REFRESH_INTERVAL);
          refreshContent(); // Initial load
        }

        function stopAutoRefresh() {
          if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
          }
        }

        function switchTab(tab) {
          currentTab = tab;
          document.getElementById('logsPanel').style.display = tab === 'logs' ? 'block' : 'none';
          document.getElementById('eventsPanel').style.display = tab === 'events' ? 'block' : 'none';
          
          // Reset refresh state
          stopAutoRefresh();
          startAutoRefresh();
        }

        function manualRefresh() {
          clearInterval(refreshInterval);
          refreshContent();
          startAutoRefresh();
        }

        // Start auto-refresh when page loads
        document.addEventListener('DOMContentLoaded', function() {
          startAutoRefresh();
        });

        // Stop auto-refresh when page is hidden
        document.addEventListener('visibilitychange', function() {
          if (document.hidden) {
            stopAutoRefresh();
          } else {
            startAutoRefresh();
          }
        });

        // Add change handlers for filters
        document.getElementById('logType').addEventListener('change', manualRefresh);
        document.getElementById('logLevel').addEventListener('change', manualRefresh);
        document.getElementById('eventType').addEventListener('change', manualRefresh);
        
        // Add search input handler with debounce
        let searchTimeout = null;
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
          searchInput.addEventListener('input', function() {
            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(function() {
              if (currentTab === 'logs') {
                manualRefresh();
              }
            }, 500); // 500ms debounce
          });
          // Also allow Enter key to search immediately
          searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && currentTab === 'logs') {
              if (searchTimeout) clearTimeout(searchTimeout);
              manualRefresh();
            }
          });
        }
      </script>
    </body>
    </html>`;
  }

  @Get()
  async getUI(@Res() reply: FastifyReply) {
    reply.header('Content-Type', 'text/html');
    return reply.send(this.getHtmlTemplate('logs'));
  }

  @Get('events')
  async getEventsPage(@Res() reply: FastifyReply) {
    reply.header('Content-Type', 'text/html');
    return reply.send(this.getHtmlTemplate('events'));
  }

  @Get('logs/data')
  @RateLimitAPI({ points: 100, duration: 60 }) // 100 requests per minute
  @ApiOperation({ summary: 'Get paginated logs with filtering' })
  @ApiResponse({
    status: 200,
    description: 'Paginated logs retrieved successfully',
    type: PaginatedLogsResponseDto,
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getLogs(@Query() query: GetLogsQueryDto): Promise<PaginatedLogsResponseDto> {
    try {
      const result = await this.loggingService.getLogs(
        query.type,
        query.startTime ? new Date(query.startTime) : undefined,
        query.endTime ? new Date(query.endTime) : undefined,
        query.level,
        query.page,
        query.limit,
        query.search
      );

      // Map logs to ensure disabled property is set
      const mappedLogs = result.logs.map((log: unknown) => ({
        ...(log as Record<string, unknown>),
        disabled: false, // Ensure disabled property is always set
      }));

      return new PaginatedLogsResponseDto(mappedLogs, result.meta);
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to fetch logs',
        'LoggingController',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      // Return empty paginated result on error
      const { PaginationMetaDto } = await import('@dtos/common-response.dto');
      const meta = new PaginationMetaDto(query.page || 1, query.limit || 100, 0);
      return new PaginatedLogsResponseDto([], meta);
    }
  }

  @Get('events/data')
  @RateLimitAPI({ points: 100, duration: 60 }) // 100 requests per minute
  @ApiOperation({ summary: 'Get paginated events with filtering' })
  @ApiResponse({
    status: 200,
    description: 'Paginated events retrieved successfully',
    type: PaginatedEventsResponseDto,
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getEvents(@Query() query: GetEventsQueryDto): Promise<PaginatedEventsResponseDto> {
    try {
      const result = await this.loggingService.getEvents(query.type, query.page, query.limit);
      return new PaginatedEventsResponseDto(result.events, result.meta);
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to fetch events',
        'LoggingController',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      // Return empty paginated result on error
      const { PaginationMetaDto } = await import('@dtos/common-response.dto');
      const meta = new PaginationMetaDto(query.page || 1, query.limit || 100, 0);
      return new PaginatedEventsResponseDto([], meta);
    }
  }

  @Get('logs/clinic/:clinicId')
  @RateLimitAPI({ points: 100, duration: 60 }) // 100 requests per minute
  @ApiOperation({ summary: 'Get paginated logs filtered by clinic ID' })
  @ApiParam({ name: 'clinicId', description: 'Clinic ID to filter logs', example: 'CL0001' })
  @ApiResponse({
    status: 200,
    description: 'Paginated clinic logs retrieved successfully',
    type: PaginatedLogsResponseDto,
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getLogsByClinic(
    @Param('clinicId') clinicId: string,
    @Query() query: GetLogsQueryDto
  ): Promise<PaginatedLogsResponseDto> {
    try {
      const result = await this.loggingService.getLogsByClinic(
        clinicId,
        query.type,
        query.startTime ? new Date(query.startTime) : undefined,
        query.endTime ? new Date(query.endTime) : undefined,
        query.level,
        query.page,
        query.limit,
        query.search
      );

      // Map logs to ensure disabled property is set
      const mappedLogs = result.logs.map((log: unknown) => ({
        ...(log as Record<string, unknown>),
        disabled: false,
      }));

      return new PaginatedLogsResponseDto(mappedLogs, result.meta);
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to fetch clinic logs',
        'LoggingController',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          clinicId,
        }
      );
      // Return empty paginated result on error
      const { PaginationMetaDto } = await import('@dtos/common-response.dto');
      const meta = new PaginationMetaDto(query.page || 1, query.limit || 100, 0);
      return new PaginatedLogsResponseDto([], meta);
    }
  }

  @Post('logs/clear')
  @RateLimitAPI({ points: 10, duration: 60 }) // 10 requests per minute (more restrictive for destructive operation)
  @ApiOperation({ summary: 'Clear logs from cache and optionally from database' })
  @ApiResponse({ status: 200, description: 'Logs cleared successfully' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async clearLogs(@Body() body: ClearLogsDto): Promise<{ success: boolean; message: string }> {
    return await this.loggingService.clearLogs(body.clearDatabase || false);
  }

  @Post('events/clear')
  async clearEvents(): Promise<{ success: boolean; message: string }> {
    return (await this.loggingService.clearEvents()) as { success: boolean; message: string };
  }
}
