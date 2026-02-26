import db from "../db.server";
import { logger } from "~/utils/logger.server";
import type { ExtendedSettings, PrismaError } from "~/types/prisma";
import type { NormalizedFormData } from "~/types/common";

// Migration helper to convert old layout values to new ones
function migrateRecommendationLayout(oldLayout: string): string {
	const migrationMap: { [key: string]: string } = {
		horizontal: "carousel",
		vertical: "list",
		row: "carousel",
		column: "list",
	};

	const newLayout = migrationMap[oldLayout] || oldLayout;

	return newLayout;
}

export interface SettingsData {
	// Activation Tracking
	appEmbedActivated: boolean;
	appEmbedActivatedAt?: Date | null;

	// Core Features
	enableApp: boolean;
	showOnlyOnCartPage: boolean;
	autoOpenCart: boolean;
	enableFreeShipping: boolean;
	freeShippingThreshold: number;

	// Advanced Features
	enableRecommendations: boolean;
	enableAddons: boolean;
	enableDiscountCode: boolean;
	enableNotes: boolean;
	enableExpressCheckout: boolean;
	enableAnalytics: boolean;
	enableTitleCaps: boolean;
	enableRecommendationTitleCaps: boolean;

	// Cart Behavior & Position
	cartIcon: string;

	// Messages & Text
	freeShippingText: string;
	freeShippingAchievedText: string;
	recommendationsTitle: string;
	actionText: string;
	addButtonText: string;
	checkoutButtonText: string;
	applyButtonText: string;
	discountLinkText: string;
	notesLinkText: string;

	// Appearance
	backgroundColor: string;
	textColor: string;
	buttonColor: string;
	buttonTextColor: string;
	recommendationsBackgroundColor: string;
	shippingBarBackgroundColor: string;
	shippingBarColor: string;
	giftBarColor: string;

	// Recommendation Settings
	recommendationLayout: string;
	maxRecommendations: number;
	complementDetectionMode: string;
	manualRecommendationProducts: string;
	// Advanced Recommendation Controls
	hideRecommendationsAfterThreshold: boolean;
	enableThresholdBasedSuggestions: boolean;
	thresholdSuggestionMode: string;
	enableManualRecommendations: boolean;

	// Gift Gating Settings
	enableGiftGating: boolean;
	progressBarMode: string;
	giftProgressStyle: string;
	giftThresholds: string;

	// Legacy fields (preserved for compatibility)
	// Sticky cart removed
	giftNoticeText?: string;
	giftPriceText?: string;

	// ML/Privacy Settings
	mlPersonalizationMode: string;
	enableMLRecommendations: boolean;
	mlPrivacyLevel: string;
	enableAdvancedPersonalization: boolean;
	enableBehaviorTracking: boolean;
	mlDataRetentionDays: string;

	// Smart Bundle Settings
	enableSmartBundles: boolean;
	bundlesOnProductPages: boolean;
	bundlesOnCollectionPages: boolean;
	bundlesOnCartPage: boolean;
	bundlesOnCheckoutPage: boolean;
	defaultBundleDiscount: string;
	bundleTitleTemplate: string;
	bundleDiscountPrefix: string;
	bundleConfidenceThreshold: string;
	bundleSavingsFormat: string;
	showIndividualPricesInBundle: boolean;
	autoApplyBundleDiscounts: boolean;

	// Enhanced Bundle Display Settings
	enableEnhancedBundles: boolean;
	showPurchaseCounts: boolean;
	showRecentlyViewed: boolean;
	showTestimonials: boolean;
	showTrustBadges: boolean;
	highlightHighValue: boolean;
	enhancedImages: boolean;
	animatedSavings: boolean;
	highValueThreshold: number;
	bundlePriority: string;
	badgeHighValueText: string;
	badgePopularText: string;
	badgeTrendingText: string;
	testimonialsList: string;

	// Theme embed status (updated by storefront heartbeat)
	themeEmbedEnabled?: boolean;
	themeEmbedLastSeen?: string; // ISO string
}

export async function getSettings(storeHash: string): Promise<SettingsData> {
	try {
		const settings = await db.settings.findUnique({
			where: { storeHash },
		});

		if (!settings) {
			// Return default settings if none exist
			return getDefaultSettings();
		}

		// Production PostgreSQL environment

		// Type-safe access with ExtendedSettings
		const typedSettings = settings as ExtendedSettings;

		// In production, mirror grid-caps to global caps
		const enableTitleCapsVal = typedSettings.enableTitleCaps ?? false;
		const enableRecommendationTitleCapsVal =
			typedSettings.enableRecommendationTitleCaps ?? enableTitleCapsVal;

		// CRITICAL: Check if appEmbedActivated field exists in DB
		// If undefined (not null/false), columns may not exist in production DB
		const hasActivationFields = 'appEmbedActivated' in settings;
		if (!hasActivationFields) {
			logger.error('⚠️ [getSettings] appEmbedActivated field missing from database!');
			logger.error('   Run: npx prisma db push');
			logger.error('   This will add the activation tracking columns');
		}

		return {
			appEmbedActivated: typedSettings.appEmbedActivated ?? false,
			appEmbedActivatedAt: typedSettings.appEmbedActivatedAt ?? null,
			enableApp: typedSettings.enableApp,
			// Sticky cart removed
			showOnlyOnCartPage: typedSettings.showOnlyOnCartPage,
			autoOpenCart: typedSettings.autoOpenCart ?? true,
			enableFreeShipping: typedSettings.enableFreeShipping,
			freeShippingThreshold: typedSettings.freeShippingThreshold,
			enableRecommendations: typedSettings.enableRecommendations,
			enableAddons: typedSettings.enableAddons,
			enableDiscountCode: typedSettings.enableDiscountCode,
			enableNotes: typedSettings.enableNotes,
			enableExpressCheckout: typedSettings.enableExpressCheckout,
			enableAnalytics: typedSettings.enableAnalytics,
			enableTitleCaps: enableTitleCapsVal,
			enableRecommendationTitleCaps: enableRecommendationTitleCapsVal,
			// Sticky cart removed
			cartIcon: typedSettings.cartIcon,
			freeShippingText: typedSettings.freeShippingText,
			freeShippingAchievedText: typedSettings.freeShippingAchievedText,
			recommendationsTitle: typedSettings.recommendationsTitle,
			actionText: typedSettings.actionText || "Add discount code",
			addButtonText: typedSettings.addButtonText ?? "Add",
			checkoutButtonText: typedSettings.checkoutButtonText ?? "CHECKOUT",
			applyButtonText: typedSettings.applyButtonText ?? "Apply",
			discountLinkText:
				typedSettings.discountLinkText ?? "+ Got a promotion code?",
			notesLinkText: typedSettings.notesLinkText ?? "+ Add order notes",

			backgroundColor: typedSettings.backgroundColor,
			textColor: typedSettings.textColor,
			buttonColor: typedSettings.buttonColor,
			buttonTextColor: typedSettings.buttonTextColor ?? "#ffffff",
			recommendationsBackgroundColor:
				typedSettings.recommendationsBackgroundColor ?? "#ecebe3",
			shippingBarBackgroundColor:
				typedSettings.shippingBarBackgroundColor ?? "#f0f0f0",
			shippingBarColor: typedSettings.shippingBarColor ?? "#121212",
			giftBarColor: typedSettings.giftBarColor ?? "#f59e0b",
			recommendationLayout: migrateRecommendationLayout(
				typedSettings.recommendationLayout,
			),
			maxRecommendations: typedSettings.maxRecommendations,
			complementDetectionMode:
				typedSettings.complementDetectionMode ?? "automatic",
			manualRecommendationProducts:
				typedSettings.manualRecommendationProducts ?? "",
			hideRecommendationsAfterThreshold:
				typedSettings.hideRecommendationsAfterThreshold ?? false,
			enableThresholdBasedSuggestions:
				typedSettings.enableThresholdBasedSuggestions ?? false,
			thresholdSuggestionMode:
				typedSettings.thresholdSuggestionMode ?? "smart",
			enableManualRecommendations:
				typedSettings.enableManualRecommendations ?? false,
			enableGiftGating: typedSettings.enableGiftGating ?? false,
			progressBarMode: typedSettings.progressBarMode ?? "free-shipping",
			giftProgressStyle: typedSettings.giftProgressStyle ?? "single-next",
			giftThresholds: typedSettings.giftThresholds ?? "[]",

			// ML/Privacy Settings
			mlPersonalizationMode: typedSettings.mlPersonalizationMode ?? "basic",
			enableMLRecommendations:
				typedSettings.enableMLRecommendations ?? false,
			mlPrivacyLevel: typedSettings.mlPrivacyLevel ?? "basic",
			enableAdvancedPersonalization:
				typedSettings.enableAdvancedPersonalization ?? false,
			enableBehaviorTracking: typedSettings.enableBehaviorTracking ?? false,
			mlDataRetentionDays: typedSettings.mlDataRetentionDays ?? "30",

		// Smart Bundle Settings
		enableSmartBundles: typedSettings.enableSmartBundles ?? false,
		bundlesOnProductPages: typedSettings.bundlesOnProductPages ?? true,
		bundlesOnCollectionPages:
			typedSettings.bundlesOnCollectionPages ?? false,
		bundlesOnCartPage: typedSettings.bundlesOnCartPage ?? false,
		bundlesOnCheckoutPage: typedSettings.bundlesOnCheckoutPage ?? false,
		defaultBundleDiscount: typedSettings.defaultBundleDiscount ?? "0",
		bundleTitleTemplate:
			typedSettings.bundleTitleTemplate ?? "Complete your setup",
		bundleDiscountPrefix: typedSettings.bundleDiscountPrefix ?? "BUNDLE",
		bundleConfidenceThreshold:
			typedSettings.bundleConfidenceThreshold ?? "medium",
		bundleSavingsFormat: typedSettings.bundleSavingsFormat ?? "both",
		showIndividualPricesInBundle:
			typedSettings.showIndividualPricesInBundle ?? true,
			autoApplyBundleDiscounts:
				typedSettings.autoApplyBundleDiscounts ?? true,

			// Enhanced Bundle Display Settings
			enableEnhancedBundles: typedSettings.enableEnhancedBundles ?? false,
			showPurchaseCounts: typedSettings.showPurchaseCounts ?? false,
			showRecentlyViewed: typedSettings.showRecentlyViewed ?? false,
			showTestimonials: typedSettings.showTestimonials ?? false,
			showTrustBadges: typedSettings.showTrustBadges ?? false,
			highlightHighValue: typedSettings.highlightHighValue ?? false,
			enhancedImages: typedSettings.enhancedImages ?? false,
			animatedSavings: typedSettings.animatedSavings ?? false,
			highValueThreshold: typedSettings.highValueThreshold ?? 150,
			bundlePriority: typedSettings.bundlePriority ?? "value",
			badgeHighValueText: typedSettings.badgeHighValueText ?? "Best Value",
			badgePopularText: typedSettings.badgePopularText ?? "Most Popular",
			badgeTrendingText: typedSettings.badgeTrendingText ?? "Trending",
			testimonialsList:
				typedSettings.testimonialsList ??
				JSON.stringify([
					{ text: "Love this combo!", author: "Sarah M." },
					{ text: "Perfect together!", author: "Mike R." },
					{ text: "Great value bundle", author: "Emma K." },
					{ text: "Exactly what I needed", author: "Alex T." },
					{ text: "Highly recommend", author: "Lisa P." },
					{ text: "Amazing quality", author: "James W." },
				]),

			themeEmbedEnabled: typedSettings.themeEmbedEnabled ?? false,
			themeEmbedLastSeen: typedSettings.themeEmbedLastSeen
				? new Date(typedSettings.themeEmbedLastSeen).toISOString()
				: undefined,
		};
	} catch (error: unknown) {
		logger.error(`Error getting settings: ${error instanceof Error ? error.message : String(error)}`);
		return getDefaultSettings();
	}
}

export async function saveSettings(
	storeHash: string,
	settingsData: Partial<SettingsData>,
): Promise<SettingsData> {
	try {

		// Convert string boolean values to actual booleans
		const normalizedData: Record<string, string | number | boolean> = {};
		for (const [key, value] of Object.entries(settingsData)) {
			if (value === "true") {
				normalizedData[key] = true;
			} else if (value === "false") {
				normalizedData[key] = false;
			} else if (value === "on") {
				// Handle checkbox form values
				normalizedData[key] = true;
			} else {
				normalizedData[key] = value;
			}
		}


		// Test database connection first
		try {
			await db.$connect();
		} catch (connectError: unknown) {
			const errorMessage = connectError instanceof Error ? connectError.message : String(connectError);
			throw new Error(`Database connection failed: ${errorMessage}`);
		}

		// Filter to only include valid SettingsData fields that exist in BOTH dev and production schemas
		const validFields: (keyof SettingsData)[] = [
			"enableApp",
			"showOnlyOnCartPage",
			"autoOpenCart",
			"enableFreeShipping",
			"freeShippingThreshold",
			"enableRecommendations",
			"enableAddons",
			"enableDiscountCode",
			"enableNotes",
			"enableExpressCheckout",
			"enableAnalytics",
			"enableGiftGating",
			"cartIcon",
			"freeShippingText",
			"freeShippingAchievedText",
			"recommendationsTitle",
			"actionText",
			"addButtonText",
			"checkoutButtonText",
			"applyButtonText",
			// Cart Interaction fields (moved from theme editor)
			"enableRecommendationTitleCaps",
			"discountLinkText",
			"notesLinkText",
			"backgroundColor",
			"textColor",
			"buttonColor",
			"buttonTextColor",
			"recommendationsBackgroundColor",
			"shippingBarBackgroundColor",
			"shippingBarColor",
			"giftBarColor",
			"recommendationLayout",
			"maxRecommendations",
			"complementDetectionMode",
			"manualRecommendationProducts",
			"hideRecommendationsAfterThreshold",
			"enableThresholdBasedSuggestions",
			"thresholdSuggestionMode",
			"enableManualRecommendations",
			"progressBarMode",
			"giftProgressStyle",
			"giftThresholds",
			"themeEmbedEnabled",
			"themeEmbedLastSeen",
			// ML/Privacy Settings
			"mlPersonalizationMode",
			"enableMLRecommendations",
			"mlPrivacyLevel",
			"enableAdvancedPersonalization",
			"enableBehaviorTracking",
			"mlDataRetentionDays",
			// Smart Bundle Settings
			"enableSmartBundles",
			"bundlesOnProductPages",
			"bundlesOnCollectionPages",
			"bundlesOnCartPage",
			"bundlesOnCheckoutPage",
			"defaultBundleDiscount",
			"bundleTitleTemplate",
			"bundleDiscountPrefix",
			"bundleConfidenceThreshold",
			"bundleSavingsFormat",
			"showIndividualPricesInBundle",
			"autoApplyBundleDiscounts",
		];

		// Dev-only fields disabled in production schema to avoid missing columns
		const devOnlyFields: (keyof SettingsData)[] = [];

		const filteredData: Partial<SettingsData> = {};
		for (const field of validFields) {
			const key = field as keyof SettingsData;
			const val = normalizedData[key];
			if (val !== undefined) {
				filteredData[key] = val as SettingsData[typeof key];
			}
		}

	// Include legacy dev-only fields if present
	for (const field of devOnlyFields) {
		const key = field as keyof SettingsData;
		const val = normalizedData[key as keyof SettingsData];
		if (val !== undefined) {
			filteredData[key] = val as SettingsData[typeof key];
		}
	}
		// Migrate recommendation layout values if present
		if (filteredData.recommendationLayout) {
			filteredData.recommendationLayout = migrateRecommendationLayout(
				filteredData.recommendationLayout,
			);
		}

		// Try saving, stripping unknown fields reported by Prisma and retrying up to 3 times
		let settings: ExtendedSettings | null = null;
		let attempt = 0;
		const dataForSave: Partial<SettingsData> = { ...filteredData };
		const maxAttempts = Math.max(10, Object.keys(filteredData).length + 2);

		const baselineSave = async (): Promise<void> => {
			const baselineFields: (keyof SettingsData)[] = [
				"enableApp",
				"showOnlyOnCartPage",
				"autoOpenCart",
				"enableFreeShipping",
				"freeShippingThreshold",
				"enableRecommendations",
				"enableAddons",
				"enableDiscountCode",
				"enableNotes",
				"enableExpressCheckout",
				"enableAnalytics",
				"cartIcon",
				"freeShippingText",
				"freeShippingAchievedText",
				"recommendationsTitle",
				"actionText",
				"addButtonText",
				"checkoutButtonText",
				"applyButtonText",
				"backgroundColor",
				"textColor",
				"buttonColor",
				"buttonTextColor",
				"recommendationsBackgroundColor",
				"shippingBarBackgroundColor",
				"shippingBarColor",
				"giftBarColor",
				"recommendationLayout",
				"maxRecommendations",
				"complementDetectionMode",
				"manualRecommendationProducts",
				"hideRecommendationsAfterThreshold",
				"enableThresholdBasedSuggestions",
				"thresholdSuggestionMode",
				"enableManualRecommendations",
				"progressBarMode",
				"giftProgressStyle",
				"giftThresholds",
				// Cart interaction fields moved from theme
				"enableRecommendationTitleCaps",
				"discountLinkText",
				"notesLinkText",
				// ML/Privacy Settings - CRITICAL: Include these or they get stripped on fallback!
				"mlPersonalizationMode",
				"enableMLRecommendations",
				"mlPrivacyLevel",
				"enableAdvancedPersonalization",
				"enableBehaviorTracking",
				"mlDataRetentionDays",
			];
			const fallbackData: Partial<SettingsData> = {};
			for (const key of baselineFields) {
				if (filteredData[key] !== undefined)
					fallbackData[key] = filteredData[key] as SettingsData[typeof key];
			}
			settings = await db.settings.upsert({
				where: { storeHash },
				create: { storeHash, ...fallbackData },
				update: fallbackData,
			}) as ExtendedSettings;
		};

		while (attempt < maxAttempts) {
			try {
				if (attempt > 0) {
					logger.log(`[Settings] Retry attempt ${attempt}...`);
				}
				settings = await db.settings.upsert({
					where: { storeHash },
					create: { storeHash, ...dataForSave },
					update: dataForSave,
				}) as ExtendedSettings;
				break;
			} catch (dbError: unknown) {
				const error = dbError as PrismaError;
				// Parse Prisma error messages to detect unknown/invalid fields
				const msg = String(error?.message || "");
				const unknownFieldMatches: string[] = [];

				// Prisma (JS) often reports: Unknown arg `fieldName` in data.update
				const unknownArgRegex =
					/Unknown (?:arg|argument) `([^`]+)` in data\.(?:create|update)/g;
				let m;
				while ((m = unknownArgRegex.exec(msg)) !== null) {
					unknownFieldMatches.push(m[1]);
				}

				// Postgres column errors might mention column name in quotes
				const columnRegex = /column\s+"([^"]+)"\s+of\s+relation\s+"settings"/gi;
				while ((m = columnRegex.exec(msg)) !== null) {
					unknownFieldMatches.push(m[1]);
				}

				// De-duplicate
				const fieldsToRemove = Array.from(new Set(unknownFieldMatches));

				if (fieldsToRemove.length === 0) {
					// As a last safety, if error mentions 'column' but we couldn't extract, remove enableTitleCaps once
					if (msg.includes("column") && "enableTitleCaps" in dataForSave) {
						delete (dataForSave as Record<string, unknown>).enableTitleCaps;
						attempt++;
						continue;
					}
					// Also try removing enableRecommendationTitleCaps if that's the issue
					if (
						msg.includes("column") &&
						"enableRecommendationTitleCaps" in dataForSave
					) {
						delete (dataForSave as Record<string, unknown>).enableRecommendationTitleCaps;
						attempt++;
						continue;
					}
					try {
						await baselineSave();
						break;
					} catch (fallbackError: unknown) {
						const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
						throw new Error(`Database save failed: ${msg} (fallback also failed: ${fallbackMsg})`);
					}
				}

				for (const field of fieldsToRemove) {
					delete (dataForSave as Record<string, unknown>)[field];
				}

				attempt++;
				if (attempt >= maxAttempts - 1) {
					try {
						await baselineSave();
						break;
					} catch (fallbackError: unknown) {
						const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
						throw new Error(`Database save failed: ${msg} (fallback also failed: ${fallbackMsg})`);
					}
				}
			}
		}

		if (!settings) {
			throw new Error("Database save failed after retries");
		}


		return {
			appEmbedActivated: settings.appEmbedActivated ?? false,
			appEmbedActivatedAt: settings.appEmbedActivatedAt ?? null,
			enableApp: settings.enableApp,
			// Sticky cart removed
			showOnlyOnCartPage: settings.showOnlyOnCartPage,
			autoOpenCart: settings.autoOpenCart ?? true,
			enableFreeShipping: settings.enableFreeShipping,
			freeShippingThreshold: settings.freeShippingThreshold,
			enableRecommendations: settings.enableRecommendations,
			enableAddons: settings.enableAddons,
			enableDiscountCode: settings.enableDiscountCode,
			enableNotes: settings.enableNotes,
			enableExpressCheckout: settings.enableExpressCheckout,
			enableAnalytics: settings.enableAnalytics,
			enableTitleCaps: settings.enableTitleCaps ?? false,
			enableRecommendationTitleCaps:
				settings.enableRecommendationTitleCaps ?? false,
			// Sticky cart removed
			cartIcon: settings.cartIcon,
			freeShippingText: settings.freeShippingText,
			freeShippingAchievedText: settings.freeShippingAchievedText,
			recommendationsTitle: settings.recommendationsTitle,
			actionText: settings.actionText || "Add discount code",
			addButtonText: settings.addButtonText ?? "Add",
			checkoutButtonText: settings.checkoutButtonText ?? "CHECKOUT",
			applyButtonText: settings.applyButtonText ?? "Apply",
			discountLinkText:
				settings.discountLinkText ?? "+ Got a promotion code?",
			notesLinkText: settings.notesLinkText ?? "+ Add order notes",

			backgroundColor: settings.backgroundColor,
			textColor: settings.textColor,
			buttonColor: settings.buttonColor,
			buttonTextColor: settings.buttonTextColor ?? "#ffffff",
			recommendationsBackgroundColor:
				settings.recommendationsBackgroundColor ?? "#ecebe3",
			shippingBarBackgroundColor:
				settings.shippingBarBackgroundColor ?? "#f0f0f0",
			shippingBarColor: settings.shippingBarColor ?? "#121212",
			giftBarColor: settings.giftBarColor ?? "#f59e0b",
			recommendationLayout: migrateRecommendationLayout(
				settings.recommendationLayout,
			),
			maxRecommendations: settings.maxRecommendations,
			complementDetectionMode:
				settings.complementDetectionMode ?? "automatic",
			manualRecommendationProducts:
				settings.manualRecommendationProducts ?? "",
			hideRecommendationsAfterThreshold:
				settings.hideRecommendationsAfterThreshold ?? false,
			enableThresholdBasedSuggestions:
				settings.enableThresholdBasedSuggestions ?? false,
			thresholdSuggestionMode:
				settings.thresholdSuggestionMode ?? "smart",
			enableManualRecommendations:
				settings.enableManualRecommendations ?? false,
			enableGiftGating: settings.enableGiftGating ?? false,
			progressBarMode: settings.progressBarMode ?? "free-shipping",
			giftProgressStyle: settings.giftProgressStyle ?? "single-next",
			giftThresholds: settings.giftThresholds ?? "[]",

			// ML/Privacy Settings
			mlPersonalizationMode: settings.mlPersonalizationMode ?? "basic",
			enableMLRecommendations:
				settings.enableMLRecommendations ?? false,
			mlPrivacyLevel: settings.mlPrivacyLevel ?? "basic",
			enableAdvancedPersonalization:
				settings.enableAdvancedPersonalization ?? false,
			enableBehaviorTracking: settings.enableBehaviorTracking ?? false,
			mlDataRetentionDays: settings.mlDataRetentionDays ?? "30",

			// Smart Bundle Settings
			enableSmartBundles: settings.enableSmartBundles ?? false,
			bundlesOnProductPages: settings.bundlesOnProductPages ?? true,
			bundlesOnCollectionPages:
				settings.bundlesOnCollectionPages ?? false,
			bundlesOnCartPage: settings.bundlesOnCartPage ?? false,
			bundlesOnCheckoutPage: settings.bundlesOnCheckoutPage ?? false,
			defaultBundleDiscount: settings.defaultBundleDiscount ?? "15",
			bundleTitleTemplate:
				settings.bundleTitleTemplate ?? "Complete your setup",
			bundleDiscountPrefix: settings.bundleDiscountPrefix ?? "BUNDLE",
			bundleConfidenceThreshold:
				settings.bundleConfidenceThreshold ?? "medium",
			bundleSavingsFormat: settings.bundleSavingsFormat ?? "both",
			showIndividualPricesInBundle:
				settings.showIndividualPricesInBundle ?? true,
			autoApplyBundleDiscounts:
				settings.autoApplyBundleDiscounts ?? true,

			// Enhanced Bundle Display Settings
			enableEnhancedBundles: settings.enableEnhancedBundles ?? false,
			showPurchaseCounts: settings.showPurchaseCounts ?? false,
			showRecentlyViewed: settings.showRecentlyViewed ?? false,
			showTestimonials: settings.showTestimonials ?? false,
			showTrustBadges: settings.showTrustBadges ?? false,
			highlightHighValue: settings.highlightHighValue ?? false,
			enhancedImages: settings.enhancedImages ?? false,
			animatedSavings: settings.animatedSavings ?? false,
			highValueThreshold: settings.highValueThreshold ?? 150,
			bundlePriority: settings.bundlePriority ?? "value",
			badgeHighValueText: settings.badgeHighValueText ?? "Best Value",
			badgePopularText: settings.badgePopularText ?? "Most Popular",
			badgeTrendingText: settings.badgeTrendingText ?? "Trending",
			testimonialsList:
				settings.testimonialsList ??
				JSON.stringify([
					{ text: "Love this combo!", author: "Sarah M." },
					{ text: "Perfect together!", author: "Mike R." },
					{ text: "Great value bundle", author: "Emma K." },
					{ text: "Exactly what I needed", author: "Alex T." },
					{ text: "Highly recommend", author: "Lisa P." },
					{ text: "Amazing quality", author: "James W." },
				]),

			themeEmbedEnabled: settings.themeEmbedEnabled ?? false,
			themeEmbedLastSeen: settings.themeEmbedLastSeen
				? new Date(settings.themeEmbedLastSeen).toISOString()
				: undefined,
		};
	} catch (error) {
		throw new Error(`Failed to save settings: ${(error as Error).message}`);
	}
}

export function getDefaultSettings(): SettingsData {
	return {
		// Activation Tracking
		appEmbedActivated: false,
		appEmbedActivatedAt: null,

		// Core Features
		enableApp: true,
		showOnlyOnCartPage: false,
		autoOpenCart: true,
		enableFreeShipping: false,
		freeShippingThreshold: 0,

		// Advanced Features
		enableRecommendations: true, // Default to TRUE so recommendations show when ML is enabled
		enableAddons: false,
		enableDiscountCode: true,
		enableNotes: false,
		enableExpressCheckout: true,
		enableAnalytics: false,
		enableTitleCaps: false,
		enableRecommendationTitleCaps: false,

		// Cart Behavior
		cartIcon: "cart",

		// Messages & Text
		freeShippingText: "You're {{ amount }} away from free shipping!",
		freeShippingAchievedText:
			"🎉 Congratulations! You've unlocked free shipping!",
		recommendationsTitle: "Hand picked for you",
		actionText: "Add discount code",
		addButtonText: "Add",
		checkoutButtonText: "CHECKOUT",
		applyButtonText: "Apply",
		discountLinkText: "+ Got a promotion code?",
		notesLinkText: "+ Add order notes",

		// Appearance
		backgroundColor: "#ffffff",
		textColor: "#1A1A1A",
		buttonColor: "var(--button-background, #000000)", // Theme button color with black fallback
		buttonTextColor: "var(--button-text, #ffffff)", // Theme button text with white fallback
		recommendationsBackgroundColor: "#ecebe3",
		shippingBarBackgroundColor: "var(--background-secondary, #f0f0f0)", // Theme secondary background with light gray fallback
		shippingBarColor: "var(--accent, #121212)", // Theme accent with green fallback
		giftBarColor: "#f59e0b", // Orange default for gifts

		// Recommendation Settings
		recommendationLayout: "carousel",
		maxRecommendations: 3,
		complementDetectionMode: "automatic",
		manualRecommendationProducts: "",
		hideRecommendationsAfterThreshold: false,
		enableThresholdBasedSuggestions: false,
		thresholdSuggestionMode: "smart",
		enableManualRecommendations: false,

		// Gift Gating Settings
		enableGiftGating: false,
		progressBarMode: "free-shipping",
		giftProgressStyle: "single-next",
		giftThresholds: "[]",

		// ML/Privacy Settings
		mlPersonalizationMode: "basic",
		enableMLRecommendations: false,
		mlPrivacyLevel: "basic",
		enableAdvancedPersonalization: false,
		enableBehaviorTracking: false,
		mlDataRetentionDays: "30",

		// Smart Bundle Settings
		enableSmartBundles: false,
	bundlesOnProductPages: true,
	bundlesOnCollectionPages: false,
	bundlesOnCartPage: false,
	bundlesOnCheckoutPage: false,
	defaultBundleDiscount: "0",
	bundleTitleTemplate: "Complete your setup",
	bundleDiscountPrefix: "BUNDLE",
	bundleConfidenceThreshold: "medium",
	bundleSavingsFormat: "both",
	showIndividualPricesInBundle: true,
	autoApplyBundleDiscounts: true,		// Enhanced Bundle Display Settings
		enableEnhancedBundles: false,
		showPurchaseCounts: false,
		showRecentlyViewed: false,
		showTestimonials: false,
		showTrustBadges: false,
		highlightHighValue: false,
		enhancedImages: false,
		animatedSavings: false,
		highValueThreshold: 150,
		bundlePriority: "value",
		badgeHighValueText: "Best Value",
		badgePopularText: "Most Popular",
		badgeTrendingText: "Trending",
		testimonialsList: JSON.stringify([
			{ text: "Love this combo!", author: "Sarah M." },
			{ text: "Perfect together!", author: "Mike R." },
			{ text: "Great value bundle", author: "Emma K." },
			{ text: "Exactly what I needed", author: "Alex T." },
			{ text: "Highly recommend", author: "Lisa P." },
			{ text: "Amazing quality", author: "James W." },
		]),

		themeEmbedEnabled: false,
		themeEmbedLastSeen: undefined,
	};
}
