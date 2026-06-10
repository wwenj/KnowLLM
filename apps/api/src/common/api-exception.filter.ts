import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();

    let code = -1;
    let msg = "Internal server error";
    let data: unknown = {};

    if (exception instanceof HttpException) {
      code = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        msg = body;
      } else if (body && typeof body === "object") {
        const record = body as Record<string, unknown>;
        msg = String(record.message || exception.message || msg);
        data = record.error ? { error: record.error } : {};
      } else {
        msg = exception.message;
      }
    } else if (exception instanceof Error) {
      msg = exception.message;
    }

    response.status(200).json({ code, msg, data });
  }
}
