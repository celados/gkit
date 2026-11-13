import { describe, expect, it } from 'vitest'

import { evaluateSlice5 } from './eval'

describe('Slice 5 evaluation contract', () => {
	it('passes the committed 40-task observation set and thresholds', async () => {
		await expect(evaluateSlice5()).resolves.toMatchObject({
			tasks: 40,
			distribution: {
				explicit_provider: 10,
				business_goal: 15,
				long_tail_native: 10,
				negative: 5,
			},
			metrics: {
				providerTop1: 1,
				discoveryWithinTwoSteps: 1,
				firstExecutableCommand: 1,
				negativePrecision: 1,
			},
			passed: true,
		})
	})
})
