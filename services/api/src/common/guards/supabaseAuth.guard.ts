import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SupabaseAdminService } from '../supabase/supabaseAdmin.service';

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly supabaseAdmin: SupabaseAdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer authorization token');
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Empty Bearer authorization token');
    }

    const { data, error } = await this.supabaseAdmin.client.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired Supabase session token');
    }

    request.user = {
      id: data.user.id,
      email: data.user.email,
    };

    return true;
  }
}
