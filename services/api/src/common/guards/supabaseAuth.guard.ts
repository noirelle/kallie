import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { Request } from 'express';
import { SupabaseAdminService } from '../supabase/supabaseAdmin.service';

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

interface JwkRecord extends crypto.JsonWebKey {
  kid?: string;
  alg?: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JwtPayload {
  sub?: string;
  email?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  aud?: string | string[];
}

const JWKS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const JWKS_REFRESH_COOLDOWN_MS = 60 * 1000; // 60 seconds
const CLOCK_SKEW_SECONDS = 30;

const ALG_CONFIG: Record<
  string,
  { hash: string; isEcdsa: boolean }
> = {
  ES256: { hash: 'sha256', isEcdsa: true },
  ES384: { hash: 'sha384', isEcdsa: true },
  ES512: { hash: 'sha512', isEcdsa: true },
  RS256: { hash: 'sha256', isEcdsa: false },
  RS384: { hash: 'sha384', isEcdsa: false },
  RS512: { hash: 'sha512', isEcdsa: false },
};

function decodeBase64UrlJson<T>(segment: string): T | null {
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(SupabaseAuthGuard.name);
  private jwksCache = new Map<string, crypto.KeyObject>();
  private jwksFetchedAt = 0;
  private inFlightJwksFetch: Promise<void> | null = null;

  constructor(private readonly supabaseAdmin: SupabaseAdminService) {}

  onModuleInit(): void {
    // Pre-warm Supabase JWKS in the background so the first API call verifies locally in <1ms
    if (this.supabaseAdmin.supabaseUrl) {
      void this.refreshJwks(true).catch(() => {});
    }
  }

  private async refreshJwks(force = false): Promise<void> {
    const baseUrl = this.supabaseAdmin.supabaseUrl;
    if (!baseUrl) return;

    const now = Date.now();
    if (!force && this.jwksCache.size > 0 && now - this.jwksFetchedAt < JWKS_TTL_MS) {
      return;
    }
    if (force && now - this.jwksFetchedAt < JWKS_REFRESH_COOLDOWN_MS && this.jwksCache.size > 0) {
      return;
    }
    if (this.inFlightJwksFetch) {
      return this.inFlightJwksFetch;
    }

    const jwksUrl = `${baseUrl}/auth/v1/.well-known/jwks.json`;
    this.inFlightJwksFetch = (async () => {
      try {
        const res = await fetch(jwksUrl, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          throw new Error(`JWKS HTTP ${res.status}`);
        }
        const body = (await res.json()) as { keys?: JwkRecord[] };
        const nextMap = new Map<string, crypto.KeyObject>();
        for (const jwk of body.keys || []) {
          try {
            const keyObj = crypto.createPublicKey({ key: jwk, format: 'jwk' });
            const keyId = jwk.kid || '__default__';
            nextMap.set(keyId, keyObj);
          } catch {
            // Skip unsupported key types
          }
        }
        if (nextMap.size > 0) {
          this.jwksCache = nextMap;
          this.jwksFetchedAt = Date.now();
          this.logger.log(`Cached ${nextMap.size} Supabase JWKS verification key(s)`);
        }
      } catch (err) {
        this.logger.warn(
          `Failed to refresh Supabase JWKS (${err instanceof Error ? err.message : String(err)}); will fall back to remote auth.getUser`,
        );
      } finally {
        this.inFlightJwksFetch = null;
      }
    })();

    return this.inFlightJwksFetch;
  }

  /**
   * Attempts local cryptographic verification of a Supabase JWT using cached JWKS.
   * Returns:
   * - AuthenticatedUser when signature and claims are verified locally (<1ms)
   * - 'invalid' when token is malformed, expired, or fails signature verification
   * - 'fallback' when local verification cannot be performed (e.g., HS256 or JWKS unavailable)
   */
  async verifyTokenLocally(
    token: string,
  ): Promise<AuthenticatedUser | 'invalid' | 'fallback'> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return 'invalid';
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeBase64UrlJson<JwtHeader>(encodedHeader);
    const payload = decodeBase64UrlJson<JwtPayload>(encodedPayload);

    if (!header?.alg || !payload) {
      return 'invalid';
    }

    const algSpec = ALG_CONFIG[header.alg];
    if (!algSpec) {
      // Unsupported algorithm for JWKS (e.g., legacy HS256) — fall back to Supabase Auth RPC
      return 'fallback';
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < nowSec) {
      return 'invalid';
    }
    if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_SECONDS > nowSec) {
      return 'invalid';
    }
    if (typeof payload.sub !== 'string' || !payload.sub) {
      return 'invalid';
    }

    const expectedIss = this.supabaseAdmin.supabaseUrl
      ? `${this.supabaseAdmin.supabaseUrl}/auth/v1`
      : '';
    if (expectedIss && payload.iss && payload.iss !== expectedIss) {
      return 'invalid';
    }

    await this.refreshJwks(false);

    const lookupId = header.kid || '__default__';
    let publicKey = this.jwksCache.get(lookupId);
    if (!publicKey && !header.kid && this.jwksCache.size === 1) {
      publicKey = this.jwksCache.values().next().value;
    }

    if (!publicKey) {
      await this.refreshJwks(true);
      publicKey = this.jwksCache.get(lookupId);
      if (!publicKey && !header.kid && this.jwksCache.size === 1) {
        publicKey = this.jwksCache.values().next().value;
      }
    }

    if (!publicKey) {
      return 'fallback';
    }

    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');
    const signature = Buffer.from(encodedSignature, 'base64url');
    const verified = crypto.verify(
      algSpec.hash,
      signingInput,
      algSpec.isEcdsa
        ? { key: publicKey, dsaEncoding: 'ieee-p1363' }
        : publicKey,
      signature,
    );

    if (!verified) {
      return 'invalid';
    }

    return {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  }

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

    if (this.supabaseAdmin.supabaseUrl) {
      const localResult = await this.verifyTokenLocally(token);
      if (localResult === 'invalid') {
        throw new UnauthorizedException('Invalid or expired Supabase session token');
      }
      if (localResult !== 'fallback') {
        request.user = localResult;
        return true;
      }
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
