import {ApiError} from 'app/common/ApiError';
import {UserProfile} from 'app/common/LoginSessionAPI';
import {expressWrap} from 'app/server/lib/expressWrap';
import {GristLoginMiddleware, GristLoginSystem, GristServer,
        setUserInSession} from 'app/server/lib/GristServer';
import {getDefaultProfile} from 'app/server/lib/MinimalLogin';
import {getOrgUrl} from 'app/server/lib/requestUtils';
import {Request} from 'express';
import {IncomingMessage} from 'http';

const cookie = require('cookie');

export type GristElectronAuthMode = 'strict' | 'none' | 'mixed';

/**
 * A bare bones login system specialized for Electron. Single, hard-coded user.
 * By default only user logging in directly through app gets admitted, everyone
 * else is anonymous.
 */
export async function getMinimalElectronLoginSystem(credential: string,
                                                    authMode: GristElectronAuthMode): Promise<GristLoginSystem> {
  // Login and logout, redirecting immediately back.  Signup is treated as login,
  // no nuance here.
  return {
    async getMiddleware(gristServer: GristServer) {
      async function getLoginRedirectUrl(req: Request, url: URL) {
        if (authMode !== 'none' && !(req as any).electronDirect) {
          return getOrgUrl(req) + 'electron_only';
        }
        await setUserInSession(req, gristServer, getDefaultProfile());
        return url.href;
      }
      const middleware: GristLoginMiddleware = {
        getLoginRedirectUrl,
        getSignUpRedirectUrl: getLoginRedirectUrl,
        async getLogoutRedirectUrl(req: Request, url: URL) {
          return url.href;
        },
        async addEndpoints(app) {
          // Make sure default user exists.
          const dbManager = gristServer.getHomeDBManager();
          const profile = getDefaultProfile();
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
        async getProfile(req: Request|IncomingMessage): Promise<UserProfile|null|undefined> {
          if ((req as any).forbidLogin) {
            return null;
          }
          return undefined;
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
