import { z } from 'zod';

export const URL_MAX = 500;

/** https only, no embedded credentials; stored in canonical `href` form. */
export const httpsUrl = z
  .string()
  .trim()
  .max(URL_MAX)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'must be an https URL without credentials')
  .transform((value) => new URL(value).href)
  .pipe(z.string().max(URL_MAX));
