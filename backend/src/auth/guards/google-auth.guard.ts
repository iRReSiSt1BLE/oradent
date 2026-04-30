import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const requestedLanguage = request?.query?.hl;
    const hl = typeof requestedLanguage === 'string' && requestedLanguage.trim()
      ? requestedLanguage.trim()
      : 'uk';

    return {
      hl,
      prompt: 'select_account',
    };
  }
}
