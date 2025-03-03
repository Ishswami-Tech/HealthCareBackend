import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { RedisService } from '../../../shared/cache/redis/redis.service';
import { KafkaService } from '../../../shared/messaging/kafka/kafka.service';
import { CreateUserDto, UserResponseDto } from '../../../libs/dtos/user.dto';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { EmailService } from '../../../shared/messaging/email/email.service';
import { EmailTemplate } from '../../../libs/types/email.types';

@Injectable()
export class AuthService {
  private readonly SALT_ROUNDS = 10;
  private readonly PASSWORD_RESET_TTL = 3600; // 1 hour
  private readonly EMAIL_VERIFICATION_TTL = 86400; // 24 hours
  private readonly TOKEN_REFRESH_TTL = 604800; // 7 days

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly kafkaService: KafkaService,
    private readonly emailService: EmailService,
  ) {
    this.ensureSuperAdmin();
  }

  private async ensureSuperAdmin() {
    const superAdminEmail = 'superadmin@healthcare.com';
    const existingSuperAdmin = await this.prisma.user.findFirst({
      where: { role: Role.SUPER_ADMIN }
    });

    if (!existingSuperAdmin) {
      const hashedPassword = await bcrypt.hash('superadmin123', this.SALT_ROUNDS);
      try {
        const superAdmin = await this.prisma.user.create({
          data: {
            email: superAdminEmail,
            password: hashedPassword,
            name: 'Super Admin',
            firstName: 'Super',
            lastName: 'Admin',
            phone: '+1234567890',
            role: Role.SUPER_ADMIN,
            age: 30,
            isVerified: true,
          }
        });

        await this.prisma.superAdmin.create({
          data: { userId: superAdmin.id }
        });

        await this.kafkaService.sendMessage('user.created', {
          userId: superAdmin.id,
          role: Role.SUPER_ADMIN,
          event: 'SUPER_ADMIN_CREATED'
        });
      } catch (error) {
        console.error('Error creating super admin:', error);
      }
    }
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          mode: 'insensitive',
          equals: email
        }
      },
      include: {
        superAdmin: true,
        doctor: true,
        patient: true,
        clinicAdmin: true,
        receptionist: true
      }
    });

    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    const { password: _, ...result } = user;
    return result;
  }

  async login(user: User, request: any) {
    const payload = { email: user.email, sub: user.id, role: user.role };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = uuidv4();
    const sessionId = uuidv4();

    // Extract device and IP information
    const userAgent = request.headers['user-agent'] || 'unknown';
    const ipAddress = request.ip || request.headers['x-forwarded-for'] || 'unknown';
    const deviceInfo = this.parseUserAgent(userAgent);

    // Store session and refresh token in Redis
    const sessionData = {
      sessionId,
      userId: user.id,
      email: user.email,
      role: user.role,
      refreshToken,
      lastLogin: new Date(),
      deviceInfo,
      ipAddress,
      userAgent,
      isActive: true,
      createdAt: new Date(),
      lastActivityAt: new Date()
    };

    // Store session data with multiple keys for different access patterns
    await Promise.all([
      // Main session data
      this.redisService.set(
        `session:${user.id}:${sessionId}`,
        JSON.stringify(sessionData),
        24 * 60 * 60
      ),
      // Refresh token mapping
      this.redisService.set(
        `refresh:${refreshToken}`,
        JSON.stringify({ userId: user.id, sessionId }),
        this.TOKEN_REFRESH_TTL
      ),
      // Active sessions index
      this.redisService.sAdd(
        `user:${user.id}:sessions`,
        sessionId
      ),
      // Device tracking
      this.redisService.set(
        `device:${user.id}:${deviceInfo.deviceId}`,
        JSON.stringify({
          sessionId,
          lastSeen: new Date(),
          deviceInfo
        }),
        30 * 24 * 60 * 60 // 30 days
      )
    ]);

    // Update last login and emit event
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { 
        lastLogin: new Date(),
        lastLoginIP: ipAddress,
        lastLoginDevice: userAgent
      },
      include: {
        doctor: true,
        patient: true,
        receptionist: true,
        clinicAdmin: true,
        superAdmin: true,
      }
    });

    // Log login event with device info
    await this.kafkaService.sendMessage('user.login', {
      userId: user.id,
      role: user.role,
      timestamp: new Date(),
      sessionId,
      deviceInfo,
      ipAddress
    });

    // Get role-specific redirect path
    const redirectPath = this.getRedirectPathForRole(user.role);

    // Remove sensitive data
    const { password: _, ...userWithoutPassword } = updatedUser;

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      session_id: sessionId,
      user: userWithoutPassword,
      redirectPath,
      permissions: this.getRolePermissions(user.role)
    };
  }

  private getRedirectPathForRole(role: Role): string {
    switch (role) {
      case Role.SUPER_ADMIN:
        return '/dashboard/admin';
      case Role.CLINIC_ADMIN:
        return '/dashboard/clinic';
      case Role.DOCTOR:
        return '/dashboard/doctor';
      case Role.PATIENT:
        return '/dashboard/patient';
      case Role.RECEPTIONIST:
        return '/dashboard/reception';
      default:
        return '/dashboard';
    }
  }

  private getRolePermissions(role: Role): string[] {
    const basePermissions = ['view_profile', 'edit_profile'];
    
    switch (role) {
      case Role.SUPER_ADMIN:
        return [
          ...basePermissions,
          'manage_users',
          'manage_clinics',
          'manage_roles',
          'view_analytics',
          'manage_system'
        ];
      case Role.CLINIC_ADMIN:
        return [
          ...basePermissions,
          'manage_clinic_staff',
          'view_clinic_analytics',
          'manage_appointments',
          'manage_inventory'
        ];
      case Role.DOCTOR:
        return [
          ...basePermissions,
          'manage_patients',
          'view_medical_records',
          'create_prescriptions',
          'manage_appointments'
        ];
      case Role.PATIENT:
        return [
          ...basePermissions,
          'view_appointments',
          'book_appointments',
          'view_prescriptions',
          'view_medical_history'
        ];
      case Role.RECEPTIONIST:
        return [
          ...basePermissions,
          'manage_appointments',
          'register_patients',
          'manage_queue',
          'basic_patient_info'
        ];
      default:
        return basePermissions;
    }
  }

  async register(createUserDto: CreateUserDto): Promise<UserResponseDto> {
    const existingUser = await this.prisma.user.findFirst({
      where: {
        email: {
          mode: 'insensitive',
          equals: createUserDto.email
        }
      }
    });

    if (existingUser) {
      throw new BadRequestException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, this.SALT_ROUNDS);
    
    const user = await this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
        isVerified: false
      },
    });

    // Create role-specific record
    switch (user.role) {
      case Role.PATIENT:
        await this.prisma.patient.create({
          data: { userId: user.id }
        });
        break;
      case Role.DOCTOR:
        await this.prisma.doctor.create({
          data: {
            userId: user.id,
            specialization: createUserDto.specialization || '',
            experience: createUserDto.experience || 0,
          }
        });
        break;
      case Role.RECEPTIONIST:
        await this.prisma.receptionist.create({
          data: { userId: user.id }
        });
        break;
      case Role.CLINIC_ADMIN:
        if (createUserDto.clinicId) {
          await this.prisma.clinicAdmin.create({
            data: {
              userId: user.id,
              clinicId: createUserDto.clinicId
            }
          });
        }
        break;
    }

    await this.kafkaService.sendMessage('user.created', {
      userId: user.id,
      role: user.role,
      event: 'USER_REGISTERED'
    });

    const { password, ...result } = user;
    return result as UserResponseDto;
  }

  async logout(userId: string, sessionId?: string, allDevices: boolean = false): Promise<void> {
    try {
      // Get all active sessions for the user
      const activeSessions = await this.redisService.sMembers(`user:${userId}:sessions`);
      
      // Determine which sessions to terminate
      const sessionsToTerminate = sessionId 
        ? [sessionId]
        : allDevices 
          ? activeSessions
          : [sessionId || activeSessions[activeSessions.length - 1]];

      for (const sid of sessionsToTerminate) {
        // Get session data
        const sessionKey = `session:${userId}:${sid}`;
        const sessionData = await this.redisService.get(sessionKey);
        
        if (sessionData) {
          const session = JSON.parse(sessionData);
          const deviceKey = `device:${userId}:${session.deviceInfo?.deviceId}`;

          // Delete session-related data
          await Promise.all([
            // Delete session data
            this.redisService.del(sessionKey),
            // Delete refresh token
            this.redisService.del(`refresh:${session.refreshToken}`),
            // Remove from active sessions
            this.redisService.sRem(`user:${userId}:sessions`, sid),
            // Update device last seen
            this.redisService.get(deviceKey).then(async (deviceData) => {
              if (deviceData) {
                const device = JSON.parse(deviceData);
                if (device.sessionId === sid) {
                  await this.redisService.set(
                    deviceKey,
                    JSON.stringify({
                      ...device,
                      lastSeen: new Date(),
                      status: 'logged_out'
                    }),
                    30 * 24 * 60 * 60 // 30 days
                  );
                }
              }
            })
          ]);

          // Log each session termination
          await this.kafkaService.sendMessage('user.session.terminated', {
            userId,
            sessionId: sid,
            deviceInfo: session.deviceInfo,
            ipAddress: session.ipAddress,
            timestamp: new Date()
          });
        }
      }

      // Update user's login status if logging out of all devices
      if (allDevices) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { lastLogin: null }
        });

        // Log complete logout
        await this.kafkaService.sendMessage('user.logout.all', {
          userId,
          timestamp: new Date(),
          sessionCount: sessionsToTerminate.length
        });
      }

      // Log the successful logout
      await this.kafkaService.sendMessage('user.logout', {
        userId,
        timestamp: new Date(),
        sessionId: sessionId || 'current',
        allDevices,
        status: 'success'
      });

    } catch (error) {
      // Log the error but don't expose internal details
      await this.kafkaService.sendMessage('user.logout.error', {
        userId,
        timestamp: new Date(),
        error: error.message,
        sessionId: sessionId || 'current',
        allDevices
      });
      
      throw new UnauthorizedException('Failed to logout properly');
    }
  }

  async refreshToken(userId: string) {
    const sessionKey = `session:${userId}`;
    const session = await this.redisService.get(sessionKey);
    
    if (!session) {
      throw new UnauthorizedException('Session expired');
    }

    const sessionData = JSON.parse(session);
    const payload = {
      email: sessionData.email,
      sub: userId,
      role: sessionData.role
    };

    const newAccessToken = this.jwtService.sign(payload);
    const newRefreshToken = uuidv4();

    // Update session with new refresh token
    sessionData.refreshToken = newRefreshToken;
    await Promise.all([
      this.redisService.set(
        sessionKey,
        JSON.stringify(sessionData),
        24 * 60 * 60
      ),
      this.redisService.set(
        `refresh:${newRefreshToken}`,
        userId,
        this.TOKEN_REFRESH_TTL
      )
    ]);

    return {
      access_token: newAccessToken,
      refresh_token: newRefreshToken
    };
  }

  async validateToken(userId: string): Promise<boolean> {
    const session = await this.redisService.get(`session:${userId}`);
    return !!session;
  }

  async sendVerificationEmail(user: User): Promise<void> {
    const token = uuidv4();
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;

    // Store token in Redis
    await this.redisService.set(
      `email_verification:${token}`,
      user.id,
      this.EMAIL_VERIFICATION_TTL
    );

    await this.emailService.sendEmail({
      to: user.email,
      subject: 'Verify Your Email',
      template: EmailTemplate.VERIFICATION,
      context: { verificationUrl }
    });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Return silently to prevent email enumeration
      return;
    }

    const token = uuidv4();
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

    // Store token in Redis
    await this.redisService.set(
      `password_reset:${token}`,
      user.id,
      this.PASSWORD_RESET_TTL
    );

    await this.emailService.sendEmail({
      to: user.email,
      subject: 'Reset Your Password',
      template: EmailTemplate.PASSWORD_RESET,
      context: { resetUrl }
    });
  }

  async sendLoginOTP(user: User): Promise<string> {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP in Redis with 5-minute expiry
    await this.redisService.set(
      `login_otp:${user.id}`,
      otp,
      300 // 5 minutes
    );

    await this.emailService.sendEmail({
      to: user.email,
      subject: 'Login Verification Code',
      template: EmailTemplate.OTP_LOGIN,
      context: { otp }
    });

    return otp;
  }

  private parseUserAgent(userAgent: string) {
    const deviceId = this.generateDeviceId(userAgent);
    const isMobile = /mobile/i.test(userAgent);
    const isTablet = /tablet|ipad/i.test(userAgent);
    const browser = this.detectBrowser(userAgent);
    const os = this.detectOS(userAgent);

    return {
      deviceId,
      type: isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop',
      browser,
      os,
      userAgent
    };
  }

  private generateDeviceId(userAgent: string): string {
    return require('crypto')
      .createHash('md5')
      .update(userAgent)
      .digest('hex');
  }

  private detectBrowser(userAgent: string): string {
    if (/chrome/i.test(userAgent)) return 'Chrome';
    if (/firefox/i.test(userAgent)) return 'Firefox';
    if (/safari/i.test(userAgent)) return 'Safari';
    if (/msie|trident/i.test(userAgent)) return 'Internet Explorer';
    if (/edge/i.test(userAgent)) return 'Edge';
    return 'Unknown';
  }

  private detectOS(userAgent: string): string {
    if (/windows/i.test(userAgent)) return 'Windows';
    if (/macintosh|mac os x/i.test(userAgent)) return 'MacOS';
    if (/linux/i.test(userAgent)) return 'Linux';
    if (/android/i.test(userAgent)) return 'Android';
    if (/ios|iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
    return 'Unknown';
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    // Verify token
    const userId = await this.verifyResetToken(token);
    
    // Hash the new password
    const hashedPassword = await this.hashPassword(newPassword);
    
    // Update user's password
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });
  }

  private async verifyResetToken(token: string): Promise<string> {
    try {
      const decoded = await this.jwtService.verifyAsync(token);
      return decoded.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }
} 