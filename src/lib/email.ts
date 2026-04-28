import { createTransport, type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
	if (!transporter) {
		const host = process.env.SMTP_HOST;
		const port = process.env.SMTP_PORT;
		const user = process.env.SMTP_LOGIN;
		const pass = process.env.SMTP_PASSWORD;

		if (!host || !port || !user || !pass) {
			throw new Error('SMTP environment variables (SMTP_HOST, SMTP_PORT, SMTP_LOGIN, SMTP_PASSWORD) must be set');
		}

		transporter = createTransport({
			host,
			port: Number(port),
			secure: false,
			auth: { user, pass },
		});
	}

	return transporter;
};

export interface EmailMessage {
	subject: string;
	html: string;
}

export const sendEmail = async (to: string, message: EmailMessage): Promise<void> => {
	const name = process.env.SMTP_FROM_NAME;
	const address = process.env.SMTP_FROM_ADDRESS;

	if (!name || !address) {
		throw new Error('SMTP_FROM_NAME and SMTP_FROM_ADDRESS environment variables must be set');
	}

	await getTransporter().sendMail({
		from: { name, address },
		to,
		subject: message.subject,
		html: message.html,
	});
};
