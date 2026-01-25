export class ResyAPIError extends Error {
    public readonly status: number;
    public readonly code?: number;
    public readonly originalError?: unknown;

    constructor(message: string, status: number, code?: number, originalError?: unknown) {
        super(message);
        this.name = "ResyAPIError";
        this.status = status;
        this.code = code;
        this.originalError = originalError;

        // Ensure proper prototype chain for instanceOf checks
        Object.setPrototypeOf(this, ResyAPIError.prototype);
    }
}
