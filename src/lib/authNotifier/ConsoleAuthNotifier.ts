import type { FastifyBaseLogger } from 'fastify';
import type { AuthNotifier } from './AuthNotifier.js';
import { maskEmail } from '../maskEmail.js';

export class ConsoleAuthNotifier implements AuthNotifier {
	private readonly logger: FastifyBaseLogger;

	constructor(logger: FastifyBaseLogger) {
		this.logger = logger;
	}

	async sendActivation(email: string, login: string, key: string, origin: string): Promise<void> {
		this.logger.info({ email: maskEmail(email), key, origin }, 'Sending activation email');
	}

	async sendPasswordReset(email: string, login: string, key: string, origin: string): Promise<void> {
		this.logger.info({ email: maskEmail(email), key, origin }, 'Sending password reset email');
	}

	async sendPasswordChanged(email: string, login: string, origin: string): Promise<void> {
		this.logger.info({ email: maskEmail(email), origin }, 'Sending password changed email');
	}

	async sendAdminActivation(email: string, login: string, key: string, origin: string): Promise<void> {
		this.logger.info({ email: maskEmail(email), key, origin }, 'Sending admin-created activation email');
	}

	async sendAdminPasswordReset(email: string, login: string, key: string, origin: string): Promise<void> {
		this.logger.info({ email: maskEmail(email), key, origin }, 'Sending admin password reset email');
	}

	async sendAdminResendActivation(email: string, login: string, key: string, origin: string): Promise<void> {
		this.logger.info({ email: maskEmail(email), key, origin }, 'Sending admin resend activation email');
	}
}
