export class ResyAPIError extends Error {
    public readonly status: number;
    public readonly code?: number;
    public readonly rawBody?: string;  // Full response body for logging

    constructor(message: string, status: number, code?: number, rawBody?: string) {
        super(message);
        this.name = "ResyAPIError";
        this.status = status;
        this.code = code;
        this.rawBody = rawBody;

        // Ensure proper prototype chain for instanceOf checks
        Object.setPrototypeOf(this, ResyAPIError.prototype);
    }
}
