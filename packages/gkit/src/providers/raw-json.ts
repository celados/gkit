import type { ErrorCode, ProviderOutcome } from '../envelope'

export type RawJsonDispatchResult =
	| {
			ok: true
			rawBytes: Uint8Array
			providerRequestId: string | null
			data: Record<string, unknown>
	  }
	| {
			ok: false
			code: ErrorCode
			message: string
			retryable: boolean
			outcome: ProviderOutcome
			details: Record<string, unknown> | null
			rawBytes: Uint8Array | null
			providerRequestId: string | null
	  }
