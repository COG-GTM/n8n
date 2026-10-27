import { SecurityConfig } from '@n8n/config';
import { Container } from '@n8n/di';

export const isWebhookHtmlSandboxingDisabled = () => {
	return Container.get(SecurityConfig).disableWebhookHtmlSandboxing;
};

/**
 * Returns the CSP header value that sandboxes the HTML page into a separate origin.
 */
export const getWebhookSandboxCSP = (): string => {
	return 'sandbox allow-downloads allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups allow-presentation allow-scripts allow-top-navigation allow-top-navigation-by-user-activation allow-top-navigation-to-custom-protocols';
};

/** MIME types that browsers render as a document which can execute scripts. */
const SCRIPTABLE_DOCUMENT_TYPES = new Set([
	'text/html',
	'application/xhtml+xml',
	'image/svg+xml',
	'application/xml',
	'text/xml',
	'application/mathml+xml',
	'text/xsl',
	'application/xslt+xml',
	'application/vnd.wap.xhtml+xml',
]);

/** MIME types that make browsers sniff the content, which may result in HTML. */
const SNIFFED_TYPES = new Set(['unknown/unknown', 'application/unknown', '*/*']);

const isScriptableEssence = (essence: string) =>
	// Invalid MIME types are ignored by browsers, which then sniff the content
	!essence.includes('/') ||
	SNIFFED_TYPES.has(essence) ||
	SCRIPTABLE_DOCUMENT_TYPES.has(essence) ||
	essence.endsWith('+xml') ||
	essence.startsWith('text/html') ||
	essence.startsWith('application/xhtml+xml');

/**
 * Checks if the given content type is something a browser might render
 * as HTML or another document type that can execute scripts (e.g. SVG or XML).
 */
export const isHtmlRenderedContentType = (contentType: string) => {
	// Browsers strip whitespace, ignore parameters (e.g. "; charset=utf-8") and
	// accept comma-separated lists of MIME types, so every candidate is checked.
	const essences = contentType
		.toLowerCase()
		.split(',')
		.map((part) => part.split(';')[0].trim())
		.filter((essence) => essence.length > 0);

	if (essences.length === 0) return true;

	return essences.some(isScriptableEssence);
};
