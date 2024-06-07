import { GristLoginMiddleware, GristLoginSystem, GristServer, setUserInSession } from "app/server/lib/GristServer";
import { ApiError } from "app/common/ApiError";
import { Request } from "express";
import { UserProfile } from "app/common/LoginSessionAPI";
import cookie from "cookie";
import { expressWrap } from "app/server/lib/expressWrap";
import { getOrgUrl } from "app/server/lib/requestUtils";


export type GristDesktopAuthMode = 'strict' | 'none' | 'mixed';

export function getProfile(): UserProfile {
  return {
    email: process.env.GRIST_DEFAULT_EMAIL as string,
    name: process.env.GRIST_DEFAULT_USERNAME as string,
  };
}

/**
 * A bare bones login system specialized for Electron. Single, hard-coded user.
 * By default only user logging in directly through app gets admitted, everyone
 * else is anonymous.
 */
export async function getMinimalElectronLoginSystem(credential: string,
                                                    authMode: GristDesktopAuthMode): Promise<GristLoginSystem> {
  // Login and logout, redirecting immediately back.  Signup is treated as login,
  // no nuance here.
  return {
    async getMiddleware(gristServer: GristServer) {
      async function getLoginRedirectUrl(req: Request, url: URL) {
        if (authMode !== 'none' && !(req as any).electronDirect) {
          return getOrgUrl(req) + 'electron_only';
        }
        await setUserInSession(req, gristServer, getProfile());
        return url.href;
      }
      const middleware: GristLoginMiddleware = {
        getLoginRedirectUrl,
        getSignUpRedirectUrl: getLoginRedirectUrl,
        async getLogoutRedirectUrl(_: Request, url: URL) {
          return url.href;
        },
        async addEndpoints(app) {
          // Make sure default user exists.
          const dbManager = gristServer.getHomeDBManager();
          const profile = getProfile();
          const user = await dbManager.getUserByLoginWithRetry(profile.email, {profile});
          if (user) {
            // No need to survey this user!
            user.isFirstTimeUser = false;
            await user.save();
          }
          app.get('/electron_only', expressWrap(async () => {
            throw new ApiError("Access restricted to Electron user",
                               401);
          }));
          return 'electron-login';
        },
        getWildcardMiddleware() {
          if (authMode === 'none') {
            return [];
          }
          return [expressWrap(async (req, res, next) => {
            const url = new URL("http://localhost" + req.url);
            const keyPresented = url.searchParams.get('electron_key');
            const cookies = cookie.parse(req.headers.cookie || '');
            const keyRemembered = cookies['electron_key'];
            if (!keyPresented && !keyRemembered) {
              (req as any).forbidLogin = true;
            }
            if (keyPresented && keyPresented !== keyRemembered) {
              res.cookie('electron_key', keyPresented);
            }
            if (keyPresented === credential || keyRemembered === credential) {
              (req as any).electronDirect = true;
            }
            return next();
          })];
        },
      };
      return middleware;
    },
    async deleteUser() {
      // nothing to do
    },
  };
}
