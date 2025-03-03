export enum EmailTemplate {
  VERIFICATION = 'VERIFICATION',
  PASSWORD_RESET = 'PASSWORD_RESET',
  OTP_LOGIN = 'OTP_LOGIN'
}

export interface EmailOptions {
  to: string;
  subject: string;
  template: EmailTemplate;
  context: any;
  text?: string;
  html?: string;
}