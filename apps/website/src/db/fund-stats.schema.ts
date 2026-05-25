import { z } from "zod";

export const fundStatSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  fundName: z.string().min(1),
  category: z.string().min(1),
  region: z.string().min(1),
  nav: z.number().nonnegative(),
  netAssets: z.number().nonnegative(),
  expenseRatio: z.number().nonnegative(),
  ytdReturn: z.number(),
  oneYearReturn: z.number(),
  threeYearReturn: z.number(),
  risk: z.enum(["Low", "Moderate", "Elevated", "High"]),
  asOf: z.iso.date(),
});

export type FundStat = z.infer<typeof fundStatSchema>;
