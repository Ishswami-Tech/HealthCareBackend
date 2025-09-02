export interface QueuePosition {
  position: number;
  estimatedWaitTime: number;
  totalAhead: number;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  avgWaitTime: number;
  estimatedWaitTime: number;
}

export interface LocationQueueStats extends QueueStats {
  locationId: string;
  doctorStats: {
    [doctorId: string]: {
      waiting: number;
      active: number;
      avgWaitTime: number;
    };
  };
}

export interface DoctorQueueStats {
  waiting: number;
  active: number;
  completed: number;
  avgWaitTime: number;
  nextAppointment?: {
    id: string;
    patientName: string;
    scheduledTime: string;
  };
} 