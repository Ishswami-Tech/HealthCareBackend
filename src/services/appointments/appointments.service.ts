import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { QueueService, JobType } from '../../shared/queue/queue.service';
import { QrService } from '../../shared/QR/qr.service';
import { LoggingService } from '../../shared/logging/logging.service';
import { LogLevel, LogType } from '../../shared/logging/types/logging.types';
import { AppointmentStatus, AppointmentType } from '@prisma/client';

@Injectable()
export class AppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly qrService: QrService,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Create a new appointment
   */
  async createAppointment(data: {
    userId: string;
    doctorId: string;
    locationId: string;
    date: string;
    time: string;
    duration: number;
    type: string;
    notes?: string;
  }) {
    try {
      // Validate doctor exists and is available at the requested time
      const isAvailable = await this.checkDoctorAvailability(
        data.doctorId,
        data.date,
        data.time,
      );

      if (!isAvailable) {
        throw new BadRequestException('Doctor is not available at the requested time');
      }

      // Create appointment in the database with appropriate type casting
      const appointment = await this.prisma.appointment.create({
        data: {
          doctorId: data.doctorId,
          patientId: data.userId,
          locationId: data.locationId,
          date: new Date(data.date),
          time: data.time,
          duration: data.duration,
          type: data.type as AppointmentType,
          notes: data.notes,
          status: AppointmentStatus.SCHEDULED,
        },
      });

      // Add to queue for processing
      await this.queueService.addJob(
        JobType.CREATE,
        {
          id: appointment.id,
          userId: data.userId,
          resourceId: appointment.id,
          resourceType: 'appointment',
          locationId: appointment.locationId,
          date: appointment.date,
        },
      );

      // Generate QR code for confirmation
      const qrCode = await this.qrService.generateAppointmentQR(appointment.id);

      // Add notification job
      await this.queueService.addJob(
        JobType.NOTIFY,
        {
          id: appointment.id,
          userId: data.userId,
          resourceId: appointment.id,
          resourceType: 'appointment',
          locationId: appointment.locationId,
          date: appointment.date,
          metadata: {
            message: 'Your appointment has been scheduled successfully',
          },
        },
      );

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Created appointment for user ${data.userId} with doctor ${data.doctorId}`,
        'AppointmentService',
        { appointmentId: appointment.id, userId: data.userId, doctorId: data.doctorId }
      );

      return {
        appointment,
        qrCode,
        message: 'Appointment created successfully',
      };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create appointment: ${error.message}`,
        'AppointmentService',
        { userId: data.userId, doctorId: data.doctorId, error: error.stack }
      );
      
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new Error(`Failed to create appointment: ${error.message}`);
    }
  }

  /**
   * Get appointments with filtering options
   */
  async getAppointments(filters: {
    userId?: string;
    doctorId?: string;
    status?: string;
    locationId?: string;
    date?: string;
  }) {
    try {
      // Build filter conditions
      const where: any = {};

      if (filters.userId) {
        where.userId = filters.userId;
      }

      if (filters.doctorId) {
        where.doctorId = filters.doctorId;
      }

      if (filters.status) {
        where.status = filters.status;
      }

      if (filters.locationId) {
        where.locationId = filters.locationId;
      }

      if (filters.date) {
        where.date = new Date(filters.date);
      }

      // Get appointments
      const appointments = await this.prisma.appointment.findMany({
        where,
        include: {
          User: true,
          doctor: {
            include: {
              user: true
            }
          },
          location: true
        },
        orderBy: {
          date: 'asc',
        },
      });

      return appointments;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get appointments: ${error.message}`,
        'AppointmentService',
        { filters, error: error.stack }
      );
      throw new Error(`Failed to get appointments: ${error.message}`);
    }
  }

  /**
   * Get appointment by ID
   */
  async getAppointmentById(appointmentId: string) {
    try {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          User: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          doctor: {
            select: {
              id: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  profilePicture: true,
                },
              },
              specialization: true,
            },
          },
        },
      });

      if (!appointment) {
        throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
      }

      return appointment;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get appointment: ${error.message}`,
        'AppointmentService',
        { appointmentId, error: error.stack }
      );
      
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new Error(`Failed to get appointment: ${error.message}`);
    }
  }

  /**
   * Update an existing appointment
   */
  async updateAppointment(
    appointmentId: string,
    updateData: {
      date?: string;
      time?: string;
      duration?: number;
      status?: string;
      notes?: string;
    },
  ) {
    try {
      // Check if appointment exists
      const existingAppointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
      });

      if (!existingAppointment) {
        throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
      }

      // Prepare update data
      const data: any = {};

      if (updateData.date) {
        data.date = new Date(updateData.date);
      }

      if (updateData.time) {
        data.time = updateData.time;
      }

      if (updateData.duration) {
        data.duration = updateData.duration;
      }

      if (updateData.status) {
        data.status = updateData.status;
      }

      if (updateData.notes) {
        data.notes = updateData.notes;
      }

      // Update appointment
      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data,
      });

      // Add update job to queue
      await this.queueService.addJob(
        JobType.UPDATE,
        {
          id: updatedAppointment.id,
          userId: updatedAppointment.userId,
          resourceId: updatedAppointment.id,
          resourceType: 'appointment',
          locationId: updatedAppointment.locationId || '',
          date: updatedAppointment.date,
          metadata: {
            doctorId: updatedAppointment.doctorId,
            status: updatedAppointment.status
          }
        }
      );

      // Send notification about update
      await this.queueService.addJob(
        JobType.NOTIFY,
        {
          id: updatedAppointment.id,
          userId: updatedAppointment.userId,
          resourceId: updatedAppointment.id,
          resourceType: 'appointment',
          locationId: updatedAppointment.locationId || '',
          date: updatedAppointment.date,
          metadata: {
            doctorId: updatedAppointment.doctorId,
            message: 'Your appointment has been updated'
          }
        }
      );

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Updated appointment ${appointmentId}`,
        'AppointmentService',
        { appointmentId, updates: updateData }
      );

      return {
        appointment: updatedAppointment,
        message: 'Appointment updated successfully',
      };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update appointment: ${error.message}`,
        'AppointmentService',
        { appointmentId, updateData, error: error.stack }
      );
      
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new Error(`Failed to update appointment: ${error.message}`);
    }
  }

  /**
   * Cancel an appointment
   */
  async cancelAppointment(appointmentId: string) {
    try {
      // Check if appointment exists
      const existingAppointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
      });

      if (!existingAppointment) {
        throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
      }

      // Can't cancel completed appointments
      if (existingAppointment.status === 'COMPLETED') {
        throw new BadRequestException('Cannot cancel a completed appointment');
      }

      // Update appointment status to CANCELLED
      const cancelledAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: 'CANCELLED' },
      });

      // Send notification about cancellation
      await this.queueService.addJob(
        JobType.NOTIFY,
        {
          id: cancelledAppointment.id,
          userId: cancelledAppointment.userId,
          resourceId: cancelledAppointment.id,
          resourceType: 'appointment',
          locationId: cancelledAppointment.locationId || '',
          date: cancelledAppointment.date,
          metadata: {
            doctorId: cancelledAppointment.doctorId,
            message: 'Your appointment has been cancelled'
          }
        }
      );

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Cancelled appointment ${appointmentId}`,
        'AppointmentService',
        { appointmentId }
      );

      return {
        message: 'Appointment cancelled successfully',
      };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to cancel appointment: ${error.message}`,
        'AppointmentService',
        { appointmentId, error: error.stack }
      );
      
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new Error(`Failed to cancel appointment: ${error.message}`);
    }
  }

  /**
   * Check doctor availability for a specific date and time
   */
  private async checkDoctorAvailability(
    doctorId: string,
    date: string,
    time: string,
  ): Promise<boolean> {
    try {
      // Get doctor's working hours
      const doctor = await this.prisma.doctor.findUnique({
        where: { id: doctorId },
      });

      if (!doctor) {
        throw new NotFoundException(`Doctor with ID ${doctorId} not found`);
      }

      if (!doctor.isAvailable) {
        return false;
      }

      // Check if doctor has an appointment at the requested time
      const existingAppointment = await this.prisma.appointment.findFirst({
        where: {
          doctorId,
          date: new Date(date),
          time,
          status: {
            notIn: ['CANCELLED'],
          },
        },
      });

      return !existingAppointment;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to check doctor availability: ${error.message}`,
        'AppointmentService',
        { doctorId, date, time, error: error.stack }
      );
      throw new Error(`Failed to check doctor availability: ${error.message}`);
    }
  }

  /**
   * Get doctor's availability for a specific date
   */
  async getDoctorAvailability(doctorId: string, date: string) {
    try {
      // Get doctor
      const doctor = await this.prisma.doctor.findUnique({
        where: { id: doctorId },
      });

      if (!doctor) {
        throw new NotFoundException(`Doctor with ID ${doctorId} not found`);
      }

      if (!doctor.isAvailable) {
        return {
          available: false,
          message: 'Doctor is not available for appointments',
          availableSlots: [],
        };
      }

      // Get doctor's working hours (this will depend on your doctor schema)
      const workingHours = doctor.workingHours || {};

      // Get all appointments for the doctor on the specified date
      const appointments = await this.prisma.appointment.findMany({
        where: {
          doctorId,
          date: new Date(date),
          status: {
            notIn: ['CANCELLED'],
          },
        },
        select: {
          time: true,
          duration: true,
        },
      });

      // Convert the date to day of the week (0-6, where 0 is Sunday)
      const dayOfWeek = new Date(date).getDay();
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const today = daysOfWeek[dayOfWeek];

      // Get available time slots based on working hours and existing appointments
      // This logic will depend on how your working hours are structured
      const todayHours = workingHours[today] || { start: '09:00', end: '17:00' };
      
      // Generate time slots (e.g., 30-minute intervals)
      const slots = this.generateTimeSlots(todayHours.start, todayHours.end, 30);
      
      // Remove booked slots
      const bookedTimes = new Set(appointments.map(a => a.time));
      const availableSlots = slots.filter(slot => !bookedTimes.has(slot));

      return {
        available: availableSlots.length > 0,
        workingHours: todayHours,
        availableSlots,
        bookedSlots: Array.from(bookedTimes),
      };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctor availability: ${error.message}`,
        'AppointmentService',
        { doctorId, date, error: error.stack }
      );
      
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new Error(`Failed to get doctor availability: ${error.message}`);
    }
  }

  /**
   * Generate time slots based on start and end time
   */
  private generateTimeSlots(start: string, end: string, intervalMinutes: number): string[] {
    const slots: string[] = [];
    const startTime = this.parseTime(start);
    const endTime = this.parseTime(end);
    
    let current = startTime;
    while (current < endTime) {
      slots.push(this.formatTime(current));
      current = new Date(current.getTime() + intervalMinutes * 60000);
    }
    
    return slots;
  }

  /**
   * Parse time string to Date object
   */
  private parseTime(timeStr: string): Date {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const time = new Date();
    time.setHours(hours, minutes, 0, 0);
    return time;
  }

  /**
   * Format Date object to time string
   */
  private formatTime(date: Date): string {
    return date.toTimeString().substring(0, 5);
  }

  /**
   * Get upcoming appointments for a user
   */
  async getUserUpcomingAppointments(userId: string) {
    try {
      const now = new Date();
      
      const appointments = await this.prisma.appointment.findMany({
        where: {
          userId,
          OR: [
            {
              date: {
                gte: now,
              },
            },
            {
              date: now,
              time: {
                gte: this.formatTime(now),
              },
            },
          ],
          status: {
            notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED],
          },
        },
        include: {
          doctor: {
            select: {
              id: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  profilePicture: true,
                },
              },
              specialization: true,
            },
          },
        },
        orderBy: [
          { date: 'asc' },
          { time: 'asc' },
        ],
      });

      // For each appointment, get its position in queue if it's scheduled for today
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const appointmentsWithQueue = await Promise.all(
        appointments.map(async (appointment) => {
          const appointmentDate = new Date(appointment.date);
          appointmentDate.setHours(0, 0, 0, 0);

          if (appointmentDate.getTime() === today.getTime() && appointment.status === AppointmentStatus.SCHEDULED) {
            const queuePosition = await this.queueService.getQueuePosition(appointment.id);
            return {
              ...appointment,
              queuePosition: queuePosition >= 0 ? queuePosition : null,
            };
          }
          return appointment;
        })
      );

      return appointmentsWithQueue;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get user appointments: ${error.message}`,
        'AppointmentService',
        { userId, error: error.stack }
      );
      throw new Error(`Failed to get user appointments: ${error.message}`);
    }
  }
} 