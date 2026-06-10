import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

export interface ApiEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<ApiEnvelope<unknown>> {
    return next.handle().pipe(
      map((data: unknown) => {
        if (isEnvelope(data)) return data;
        return {
          code: 0,
          msg: "ok",
          data: data ?? {}
        };
      })
    );
  }
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "code" in value &&
      "msg" in value &&
      "data" in value
  );
}
