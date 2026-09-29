import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getFareProvider, getMailer, getRepository } from "@/lib/services";
import { createWatchAndScan } from "@/lib/watches/create-watch";
import { ProviderNotConfiguredError } from "@/lib/providers/fare-provider";
import {
  databaseDiagnosis,
  errorDetail,
  errorMessage,
  isDatabaseFault,
  isTransportFailure,
} from "@/lib/errors";
import { routeGuard } from "@/lib/api/respond";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

export async function GET() {
  return routeGuard({ route: "/api/watches", method: "GET" }, async () => {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const watches = await getRepository().listWatchesForUser(user.id);
    return NextResponse.json({ watches });
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const watch = await createWatchAndScan({
      userId: user.id,
      email: user.email,
      body,
      repo: getRepository(),
      provider: getFareProvider(),
      mailer: getMailer(),
    });
    return NextResponse.json({ watch }, { status: 201 });
  } catch (error) {
    const message = errorMessage(error);
    const transport = isTransportFailure(error);
    logger.error("watch.create_failed", {
      userId: user.id,
      guest: Boolean(user.isGuest),
      transport,
      message,
      // The raw text, which used to be the thing the reader saw instead.
      detail: errorDetail(error),
    });
    if (error instanceof ProviderNotConfiguredError) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    /* 400 says "your request was wrong, edit it and send it again". For a
       database fault that is false and it is cruel — nothing the traveller
       could change about this request would have worked, and the form invites
       them to try.
       
       This condition used to be `transport || message.includes("guest fix") ||
       message.includes("Database needs")`: a string match against the
       sentence this very function had just generated. It covered the
       transport faults and, by accident of wording, one other. A missing
       schema and a row-level-security refusal matched nothing, so the two
       faults that most need "an operator must fix this" were answered with
       "your request was wrong" and shipped no `retryWorks` at all.
       
       Asked of the diagnosis now, which reads the original error rather than
       the prose that replaced it. */
    const status = isDatabaseFault(error) ? 503 : 400;
    /* `retryWorks` travels with the error, because the client draws a
       different closing line for "try again in a minute" than for "someone
       has to go and fix this". It used to say the first one in both cases,
       under a list of fares, to a person whose trip had just been lost. */
    const verdict = status === 503 ? databaseDiagnosis(error) : null;
    return NextResponse.json(
      verdict
        ? { error: message, fault: verdict.fault, retryWorks: verdict.retryWorks }
        : { error: message },
      { status },
    );
  }
}
