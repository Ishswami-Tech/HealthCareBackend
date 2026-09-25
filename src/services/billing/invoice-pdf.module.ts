import { Module } from '@nestjs/common';
import { InvoicePDFService } from './invoice-pdf.service';
import { LoggingModule } from '@infrastructure/logging';
import { ConfigModule } from '@config/config.module';

@Module({
  imports: [ConfigModule, LoggingModule],
  providers: [
    InvoicePDFService,
    {
      provide: 'InvoicePDFService',
      useExisting: InvoicePDFService,
    },
  ],
  exports: [InvoicePDFService, 'InvoicePDFService'],
})
export class InvoicePDFModule {}

// Re-export the service class so other modules can reference the type
// without importing the service file directly.
export { InvoicePDFService } from './invoice-pdf.service';
