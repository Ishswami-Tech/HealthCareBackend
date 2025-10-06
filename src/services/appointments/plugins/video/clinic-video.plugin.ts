import { Injectable } from "@nestjs/common";
import { BaseAppointmentPlugin } from "../base/base-plugin.service";
import { VideoService } from "./video.service";
import { JitsiVideoService } from "./jitsi-video.service";
import { VideoConsultationTracker } from "./video-consultation-tracker.service";

@Injectable()
export class ClinicVideoPlugin extends BaseAppointmentPlugin {
  readonly name = "clinic-video-plugin";
  readonly version = "1.0.0";
  readonly features = [
    "video-calls",
    "consultation-rooms",
    "recording",
    "screen-sharing",
    "medical-imaging",
    "jitsi-consultation",
    "real-time-tracking",
    "hipaa-compliance",
  ];

  constructor(
    private readonly videoService: VideoService,
    private readonly jitsiVideoService: JitsiVideoService,
    private readonly consultationTracker: VideoConsultationTracker,
  ) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const videoData = data as any;
    this.logPluginAction("Processing clinic video operation", {
      operation: videoData.operation,
    });

    // Delegate to existing video service - no functionality change
    switch (videoData.operation) {
      case "createVideoCall":
        return await this.videoService.createVideoCall(
          videoData.appointmentId,
          videoData.patientId,
          videoData.doctorId,
          videoData.clinicId,
        );

      case "joinVideoCall":
        return await this.videoService.joinVideoCall(
          videoData.callId,
          videoData.userId,
        );

      case "endVideoCall":
        return await this.videoService.endVideoCall(
          videoData.callId,
          videoData.userId,
        );

      case "startRecording":
        return await this.videoService.startRecording(
          videoData.callId,
          videoData.userId,
        );

      case "stopRecording":
        return await this.videoService.stopRecording(
          videoData.callId,
          videoData.userId,
        );

      case "shareMedicalImage":
        return await this.videoService.shareMedicalImage(
          videoData.callId,
          videoData.userId,
          videoData.imageData,
        );

      case "getVideoCallHistory":
        return await this.videoService.getVideoCallHistory(
          videoData.userId,
          videoData.clinicId,
        );

      // Jitsi consultation operations
      case "createConsultationRoom":
        return await this.jitsiVideoService.createConsultationRoom(
          videoData.appointmentId,
          videoData.patientId,
          videoData.doctorId,
          videoData.clinicId,
          videoData.options,
        );

      case "generateJoinToken":
        return await this.jitsiVideoService.generateMeetingToken(
          videoData.appointmentId,
          videoData.userId,
          videoData.userRole,
          videoData.displayName,
        );

      case "startConsultationSession":
        return await this.jitsiVideoService.startConsultation(
          videoData.appointmentId,
          videoData.userId,
          videoData.userRole,
        );

      case "endConsultationSession":
        return await this.jitsiVideoService.endConsultation(
          videoData.appointmentId,
          videoData.userId,
          videoData.sessionNotes,
        );

      case "getConsultationStatus":
        return await this.jitsiVideoService.getConsultationStatus(
          videoData.appointmentId,
        );

      case "reportTechnicalIssue":
        return await this.jitsiVideoService.reportTechnicalIssue(
          videoData.appointmentId,
          videoData.userId,
          videoData.issueType,
          videoData.description,
        );

      // Real-time tracking operations
      case "initializeTracking":
        return await this.consultationTracker.initializeConsultationTracking(
          videoData.appointmentId,
          videoData.patientId,
          videoData.doctorId,
        );

      case "trackParticipantJoined":
        return await this.consultationTracker.trackParticipantJoined(
          videoData.appointmentId,
          videoData.userId,
          videoData.userRole,
          videoData.deviceInfo,
        );

      case "trackParticipantLeft":
        return await this.consultationTracker.trackParticipantLeft(
          videoData.appointmentId,
          videoData.userId,
          videoData.userRole,
        );

      case "updateConnectionQuality":
        return await this.consultationTracker.updateConnectionQuality(
          videoData.appointmentId,
          videoData.userId,
          videoData.quality,
        );

      case "trackRecordingStatus":
        return await this.consultationTracker.trackRecordingStatus(
          videoData.appointmentId,
          videoData.isRecording,
          videoData.recordingDuration,
        );

      case "getConsultationMetrics":
        return await this.consultationTracker.getConsultationMetrics(
          videoData.appointmentId,
        );

      case "endTracking":
        return await this.consultationTracker.endConsultationTracking(
          videoData.appointmentId,
        );

      default:
        this.logPluginError("Unknown video operation", {
          operation: videoData.operation,
        });
        throw new Error(`Unknown video operation: ${videoData.operation}`);
    }
  }

  async validate(data: unknown): Promise<boolean> {
    const pluginData = data as any;
    // Validate that required fields are present for each operation
    const requiredFields = {
      // Legacy video call operations
      createVideoCall: ["appointmentId", "patientId", "doctorId", "clinicId"],
      joinVideoCall: ["callId", "userId"],
      endVideoCall: ["callId", "userId"],
      startRecording: ["callId", "userId"],
      stopRecording: ["callId", "userId"],
      shareMedicalImage: ["callId", "userId", "imageData"],
      getVideoCallHistory: ["userId"],

      // Jitsi consultation operations
      createConsultationRoom: [
        "appointmentId",
        "patientId",
        "doctorId",
        "clinicId",
      ],
      generateJoinToken: ["appointmentId", "userId", "userRole", "displayName"],
      startConsultationSession: ["appointmentId", "userId", "userRole"],
      endConsultationSession: ["appointmentId", "userId"],
      getConsultationStatus: ["appointmentId"],
      reportTechnicalIssue: [
        "appointmentId",
        "userId",
        "issueType",
        "description",
      ],

      // Real-time tracking operations
      initializeTracking: ["appointmentId", "patientId", "doctorId"],
      trackParticipantJoined: ["appointmentId", "userId", "userRole"],
      trackParticipantLeft: ["appointmentId", "userId", "userRole"],
      updateConnectionQuality: ["appointmentId", "userId", "quality"],
      trackRecordingStatus: ["appointmentId", "isRecording"],
      getConsultationMetrics: ["appointmentId"],
      endTracking: ["appointmentId"],
    };

    const videoData = data as any;
    const operation = videoData.operation;
    const fields = requiredFields[operation as keyof typeof requiredFields];

    if (!fields) {
      this.logPluginError("Invalid operation", { operation });
      return false;
    }

    const isValid = fields.every(
      (field: string) => videoData[field] !== undefined,
    );
    if (!isValid) {
      this.logPluginError("Missing required fields", {
        operation,
        requiredFields: fields,
      });
    }

    return isValid;
  }
}
