import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { SecretBox } from './cipher';

@Global()
@Module({
  providers: [
    {
      provide: SecretBox,
      useFactory: (env: Env) => new SecretBox(env.SECRETS_ENCRYPTION_KEY),
      inject: [ENV],
    },
  ],
  exports: [SecretBox],
})
export class CryptoModule {}
