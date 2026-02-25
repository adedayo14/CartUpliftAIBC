declare module "*.css";

// BigCommerce App Bridge custom elements
declare namespace JSX {
	interface IntrinsicElements {
		"s-app-nav": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
		"s-link": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
			to?: string;
			external?: boolean;
		};
	}
}
