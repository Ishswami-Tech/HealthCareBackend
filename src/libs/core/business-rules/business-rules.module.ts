import { Module } from '@nestjs/common';
import { BusinessRulesEngine } from './business-rules-engine.service';
import { RuleValidationService } from './services/rule-validation.service';

@Module({
  providers: [BusinessRulesEngine, RuleValidationService],
  exports: [BusinessRulesEngine, RuleValidationService],
})
export class BusinessRulesModule {}
