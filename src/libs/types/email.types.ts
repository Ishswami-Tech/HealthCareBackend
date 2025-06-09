export enum EmailTemplate {
  VERIFICATION = 'VERIFICATION',
  PASSWORD_RESET = 'PASSWORD_RESET',
  PASSWORD_RESET_CONFIRMATION = 'PASSWORD_RESET_CONFIRMATION',
  OTP_LOGIN = 'OTP_LOGIN',
  MAGIC_LINK = 'MAGIC_LINK',
  SECURITY_ALERT = 'SECURITY_ALERT'
}

export interface EmailOptions {
  to: string;
  subject: string;
  template: EmailTemplate;
  context: any;
  text?: string;
  html?: string;
}