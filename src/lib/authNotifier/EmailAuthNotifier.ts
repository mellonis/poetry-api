import type { FastifyBaseLogger } from 'fastify';
import type { AuthNotifier } from './AuthNotifier.js';
import { sendEmail } from '../email.js';
import {
	activationEmail,
	adminActivationEmail,
	adminPasswordResetEmail,
	adminResendActivationEmail,
	passwordChangedEmail,
	resetPasswordEmail,
} from '../emailTemplates.js';
import { maskEmail } from '../maskEmail.js';

export class EmailAuthNotifier implements AuthNotifier {
	private readonly logger: FastifyBaseLogger;

	constructor(logger: FastifyBaseLogger) {
		this.logger = logger;
	}

	async sendActivation(email: string, login: string, key: string, origin: string): Promise<void> {
		const href = `${origin}/activate/?key=${key}`;
		this.logger.info({ email: maskEmail(email), origin }, 'Sending activation email');
		await sendEmail(email, activationEmail(origin, login, href));
	}

	async sendPasswordReset(email: string, login: string, key: string, origin: string): Promise<void> {
		const href = `${origin}/reset-password/?key=${key}`;
		this.logger.info({ email: maskEmail(email), origin }, 'Sending password reset email');
		await sendEmail(email, resetPasswordEmail(origin, login, href));
	}

	async sendPasswordChanged(email: string, login: string, origin: string): Promise<void> {
		const resetHref = `${origin}/reset-password/`;
		this.logger.info({ email: maskEmail(email), origin }, 'Sending password changed email');
		await sendEmail(email, passwordChangedEmail(origin, login, resetHref));
	}

	async sendAdminActivation(email: string, login: string, key: string, origin: string): Promise<void> {
		const href = `${origin}/activate/?key=${key}`;
		this.logger.info({ email: maskEmail(email), origin }, 'Sending admin-created activation email');
		await sendEmail(email, adminActivationEmail(origin, login, href));
	}

	async sendAdminPasswordReset(email: string, login: string, key: string, origin: string): Promise<void> {
		const href = `${origin}/reset-password/?key=${key}`;
		this.logger.info({ email: maskEmail(email), origin }, 'Sending admin password reset email');
		await sendEmail(email, adminPasswordResetEmail(origin, login, href));
	}

	async sendAdminResendActivation(email: string, login: string, key: string, origin: string): Promise<void> {
		const href = `${origin}/activate/?key=${key}`;
		this.logger.info({ email: maskEmail(email), origin }, 'Sending admin resend activation email');
		await sendEmail(email, adminResendActivationEmail(origin, login, href));
	}
}
