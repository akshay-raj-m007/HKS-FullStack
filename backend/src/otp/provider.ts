import { env } from "../config/env.js";
export interface OtpDeliveryProvider {
  send(phone: string, code: string): Promise<void>;
}
export class ConsoleOtpProvider implements OtpDeliveryProvider {
  async send(phone: string, code: string) {
    if (env.NODE_ENV !== "development")
      throw new Error("Console OTP is only available in development.");
    console.log("[DEV OTP] " + phone + " => " + code);
  }
}
