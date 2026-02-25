import React from "react";
import {
  Box as BDBox,
  Flex,
  Panel,
  Text as BDText,
  H1,
  H2,
  H3,
  Small,
  Button as BDButton,
  Badge as BDBadge,
  Grid as BDGrid,
  ProgressBar as BDProgressBar,
  Modal as BDModal,
  Input,
  Textarea,
  Checkbox as BDCheckbox,
  Select as BDSelect,
  Radio as BDRadio,
  Tabs as BDTabs,
  HR,
} from "@bigcommerce/big-design";
import { ArrowBackIcon, CloseIcon } from "@bigcommerce/big-design-icons";

const spacingMap: Record<string, string> = {
  "0": "0",
  "050": "0.125rem",
  "100": "0.25rem",
  "150": "0.375rem",
  "200": "0.5rem",
  "300": "0.75rem",
  "400": "1rem",
  "500": "1.25rem",
  "600": "1.5rem",
  "700": "1.75rem",
  "800": "2rem",
};

const polarisBreakpointOrder = ["xs", "sm", "md", "lg", "xl"] as const;
const bigDesignBreakpointOrder = ["mobile", "tablet", "desktop", "wide"] as const;

function mapSpacing(value?: string | number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return `${value}px`;
  return spacingMap[value] ?? value;
}

function mapColumns(columns?: number | string | Record<string, number | string>) {
  if (columns === undefined || columns === null) return undefined;

  const mapValue = (value: number | string) =>
    typeof value === "number" ? `repeat(${value}, minmax(0, 1fr))` : value;

  if (typeof columns === "number" || typeof columns === "string") {
    return mapValue(columns);
  }

  const hasBigDesign = bigDesignBreakpointOrder.some((key) => key in columns);
  const hasPolaris = polarisBreakpointOrder.some((key) => key in columns);

  if (hasBigDesign) {
    const mapped: Record<string, string> = {};
    bigDesignBreakpointOrder.forEach((key) => {
      const value = columns[key];
      if (value !== undefined) mapped[key] = mapValue(value);
    });
    return mapped;
  }

  if (hasPolaris) {
    const pick = (keys: string[]) => {
      for (const key of keys) {
        const value = columns[key];
        if (value !== undefined) return mapValue(value);
      }
      return undefined;
    };

    const mobile = pick(["xs", "sm", "md", "lg", "xl"]);
    const tablet = pick(["md", "sm", "lg", "xs", "xl"]);
    const desktop = pick(["lg", "md", "xl", "sm", "xs"]);
    const wide = pick(["xl", "lg", "md", "sm", "xs"]);

    const mapped: Record<string, string> = {};
    if (mobile) mapped.mobile = mobile;
    if (tablet) mapped.tablet = tablet;
    if (desktop) mapped.desktop = desktop;
    if (wide) mapped.wide = wide;
    return mapped;
  }

  return Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [key, mapValue(value)])
  );
}

function mapBackground(background?: string): keyof import("@bigcommerce/big-design-theme").Colors | undefined {
  switch (background) {
    case "bg-surface-secondary":
      return "secondary10";
    case "bg-surface-caution":
      return "warning10";
    case "bg-surface-success":
      return "success10";
    case "bg-fill-info":
      return "primary10";
    case "bg-fill-warning":
      return "warning10";
    case "bg-fill-success":
      return "success10";
    default:
      return undefined;
  }
}

function mapBorderRadius(radius?: string | number): string | undefined {
  if (!radius) return undefined;
  if (typeof radius === "number") return `${radius}px`;
  switch (radius) {
    case "100":
      return "4px";
    case "200":
      return "6px";
    case "300":
      return "8px";
    default:
      return radius;
  }
}

function mapToneToBadgeVariant(tone?: string): "danger" | "secondary" | "success" | "warning" | "primary" {
  switch (tone) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "attention":
      return "warning";
    case "critical":
      return "danger";
    case "info":
      return "primary";
    case "new":
      return "primary";
    default:
      return "secondary";
  }
}

function mapToneToBannerColor(tone?: string): { border: string; background: string } {
  switch (tone) {
    case "success":
      return { border: "#2e7d32", background: "#e8f5e9" };
    case "warning":
      return { border: "#ed6c02", background: "#fff3e0" };
    case "critical":
      return { border: "#c62828", background: "#ffebee" };
    case "info":
    default:
      return { border: "#1565c0", background: "#e3f2fd" };
  }
}

function mapTextColor(tone?: string): "secondary" | undefined {
  if (tone === "subdued") return "secondary";
  return undefined;
}

export const Box: React.FC<any> = ({
  padding,
  paddingBlockStart,
  paddingBlockEnd,
  paddingInlineStart,
  paddingInlineEnd,
  background,
  borderRadius,
  style,
  ...rest
}) => {
  const inlineStyle: React.CSSProperties = {
    padding: mapSpacing(padding),
    paddingTop: mapSpacing(paddingBlockStart),
    paddingBottom: mapSpacing(paddingBlockEnd),
    paddingLeft: mapSpacing(paddingInlineStart),
    paddingRight: mapSpacing(paddingInlineEnd),
    borderRadius: mapBorderRadius(borderRadius),
    ...style,
  };

  const backgroundColor = mapBackground(background);

  return (
    <BDBox {...rest} backgroundColor={backgroundColor} style={inlineStyle} />
  );
};

export const Page: React.FC<any> = ({
  title,
  subtitle,
  primaryAction,
  secondaryActions,
  backAction,
  fullWidth,
  children,
}) => {
  const actionButtons = [] as React.ReactNode[];

  if (secondaryActions && Array.isArray(secondaryActions)) {
    secondaryActions.forEach((action: any, index: number) => {
      const button = (
        <BDButton
          key={`secondary-${index}`}
          variant="secondary"
          onClick={action.onAction}
          disabled={action.disabled}
        >
          {action.content}
        </BDButton>
      );
      actionButtons.push(
        action.url ? (
          <a key={`secondary-link-${index}`} href={action.url} target={action.external ? "_blank" : undefined} rel={action.external ? "noreferrer" : undefined}>
            {button}
          </a>
        ) : (
          button
        )
      );
    });
  }

  if (primaryAction) {
    const button = (
      <BDButton
        key="primary"
        variant="primary"
        onClick={primaryAction.onAction}
        isLoading={primaryAction.loading}
        disabled={primaryAction.disabled}
      >
        {primaryAction.content}
      </BDButton>
    );
    actionButtons.push(
      primaryAction.url ? (
        <a key="primary-link" href={primaryAction.url} target={primaryAction.external ? "_blank" : undefined} rel={primaryAction.external ? "noreferrer" : undefined}>
          {button}
        </a>
      ) : (
        button
      )
    );
  }

  return (
    <BDBox
      padding="medium"
      style={{
        maxWidth: fullWidth ? "100%" : "1200px",
        margin: "0 auto",
      }}
    >
      {(title || backAction) && (
        <Flex flexDirection="column" flexGap="0.5rem" marginBottom="medium">
          {backAction && (
            backAction.url ? (
              <a href={backAction.url} target={backAction.external ? "_blank" : undefined} rel={backAction.external ? "noreferrer" : undefined}>
                <BDButton variant="subtle" iconLeft={<ArrowBackIcon />}>
                  {backAction.content || "Back"}
                </BDButton>
              </a>
            ) : (
              <BDButton
                variant="subtle"
                iconLeft={<ArrowBackIcon />}
                onClick={backAction.onAction}
              >
                {backAction.content || "Back"}
              </BDButton>
            )
          )}
          {title && <H1>{title}</H1>}
          {subtitle && <BDText color="secondary">{subtitle}</BDText>}
          {actionButtons.length > 0 && (
            <Flex flexDirection="row" flexGap="0.5rem" flexWrap="wrap">
              {actionButtons}
            </Flex>
          )}
        </Flex>
      )}
      {children}
    </BDBox>
  );
};

export const Layout: React.FC<any> & { Section: React.FC<any> } = ({ children }) => (
  <Flex flexDirection="column" flexGap="1.5rem">{children}</Flex>
);

Layout.Section = ({ children }: any) => (
  <BDBox>{children}</BDBox>
);

export const Card: React.FC<any> = ({ title, children, padding, background, style, ...rest }) => {
  const backgroundColor = mapBackground(background);
  const innerPadding = mapSpacing(padding) || "1rem";

  return (
    <Panel {...rest} style={style}>
      <BDBox backgroundColor={backgroundColor} style={{ padding: innerPadding, borderRadius: mapBorderRadius("200") }}>
        {title && (
          <BDBox marginBottom="small">
            <H3>{title}</H3>
          </BDBox>
        )}
        {children}
      </BDBox>
    </Panel>
  );
};

export const BlockStack: React.FC<any> = ({ gap, children, ...rest }) => (
  <Flex flexDirection="column" flexGap={mapSpacing(gap) || "1rem"} {...rest}>
    {children}
  </Flex>
);

export const InlineStack: React.FC<any> = ({ gap, align, blockAlign, wrap, children, ...rest }) => (
  <Flex
    flexDirection="row"
    flexGap={mapSpacing(gap) || "0.75rem"}
    justifyContent={align === "start" ? "flex-start" : align === "end" ? "flex-end" : align || "flex-start"}
    alignItems={blockAlign === "start" ? "flex-start" : blockAlign === "end" ? "flex-end" : blockAlign || "center"}
    flexWrap={wrap ? "wrap" : "nowrap"}
    {...rest}
  >
    {children}
  </Flex>
);

export const InlineGrid: React.FC<any> = ({ columns, gap, children, ...rest }) => {
  const gridColumns = mapColumns(columns);

  return (
    <BDGrid gridColumns={gridColumns} gridGap={mapSpacing(gap) || "1rem"} {...rest}>
      {children}
    </BDGrid>
  );
};

export const Grid = InlineGrid;

export const Text: React.FC<any> = ({ variant, tone, as, fontWeight, children, style, ...rest }) => {
  const color = mapTextColor(tone);
  const mergedStyle = fontWeight ? { ...(style || {}), fontWeight } : style;

  if (variant?.startsWith("heading") || as === "h1" || as === "h2" || as === "h3") {
    if (variant === "heading2xl" || variant === "headingXl" || as === "h1") {
      return <H1 {...rest} style={mergedStyle}>{children}</H1>;
    }
    if (variant === "headingLg" || variant === "headingMd" || as === "h2") {
      return <H2 {...rest} style={mergedStyle}>{children}</H2>;
    }
    return <H3 {...rest} style={mergedStyle}>{children}</H3>;
  }

  if (variant === "bodySm" || variant === "bodyXs") {
    return <Small color={color} {...rest} style={mergedStyle}>{children}</Small>;
  }

  return <BDText color={color} {...rest} style={mergedStyle}>{children}</BDText>;
};

export const Button: React.FC<any> = ({ variant, tone, size, plain, icon, loading, ...rest }) => {
  let mappedVariant: "primary" | "secondary" | "subtle" | "utility" = "secondary";
  if (variant === "primary") mappedVariant = "primary";
  if (variant === "secondary") mappedVariant = "secondary";
  if (variant === "tertiary" || plain) mappedVariant = "subtle";
  if (tone === "critical") mappedVariant = "secondary";

  const iconNode = React.isValidElement(icon)
    ? icon
    : typeof icon === "function"
    ? React.createElement(icon)
    : icon;

  return <BDButton variant={mappedVariant} iconLeft={iconNode} isLoading={loading} {...rest} />;
};

export const ButtonGroup: React.FC<any> = ({ children }) => (
  <Flex flexDirection="row" flexGap="0.5rem" flexWrap="wrap">{children}</Flex>
);

export const Badge: React.FC<any> = ({ tone, status, children, ...rest }) => {
  const label = typeof children === "string" || typeof children === "number" ? String(children) : "";
  const variant = mapToneToBadgeVariant(tone || status);
  return <BDBadge label={label} variant={variant} {...rest} />;
};

export const Banner: React.FC<any> = ({ title, tone, children, onDismiss }) => {
  const styles = mapToneToBannerColor(tone);
  return (
    <BDBox
      style={{
        borderLeft: `4px solid ${styles.border}`,
        backgroundColor: styles.background,
        padding: "1rem",
        borderRadius: "6px",
      }}
    >
      <Flex flexDirection="row" justifyContent="space-between" alignItems="flex-start" flexGap="1rem">
        <BDBox>
          {title && <H3>{title}</H3>}
          {children}
        </BDBox>
        {onDismiss && (
          <BDButton variant="subtle" iconOnly={<CloseIcon />} onClick={onDismiss} />
        )}
      </Flex>
    </BDBox>
  );
};

export const Divider: React.FC<any> = () => <HR />;

export const Modal: React.FC<any> & { Section: React.FC<any> } = ({ open, onClose, title, primaryAction, secondaryActions, children }) => {
  const actions = [] as Array<{ text: string; variant?: "secondary" | "subtle" | "utility"; onClick: () => void; isLoading?: boolean; disabled?: boolean }>;

  if (secondaryActions && Array.isArray(secondaryActions)) {
    secondaryActions.forEach((action: any, index: number) => {
      actions.push({
        text: action.content,
        variant: "subtle",
        onClick: action.onAction,
        disabled: action.disabled,
      });
    });
  }

  if (primaryAction) {
    actions.push({
      text: primaryAction.content,
      variant: "primary" as any,
      onClick: primaryAction.onAction,
      isLoading: primaryAction.loading,
      disabled: primaryAction.disabled,
    } as any);
  }

  return (
    <BDModal isOpen={open} onClose={onClose} header={title} actions={actions}>
      {children}
    </BDModal>
  );
};

Modal.Section = ({ children }: any) => (
  <BDBox padding="medium">{children}</BDBox>
);

export const TextField: React.FC<any> = ({
  label,
  labelHidden,
  value,
  onChange,
  type,
  multiline,
  helpText,
  suffix,
  requiredIndicator,
  ...rest
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (onChange) {
      onChange(event.target.value);
    }
  };

  if (multiline) {
    return (
      <Textarea
        label={labelHidden ? undefined : label}
        aria-label={labelHidden ? label : undefined}
        value={value}
        onChange={handleChange}
        description={helpText}
        {...rest}
      />
    );
  }

  return (
    <Input
      label={labelHidden ? undefined : label}
      aria-label={labelHidden ? label : undefined}
      value={value}
      onChange={handleChange}
      type={type}
      iconRight={suffix ? <Small>{suffix}</Small> : undefined}
      description={helpText}
      required={requiredIndicator || rest.required}
      {...rest}
    />
  );
};

export const Select: React.FC<any> = ({ label, labelHidden, value, onChange, options, helpText, ...rest }) => {
  const mappedOptions = (options || []).map((option: any) => ({
    content: option.label ?? option.content ?? String(option.value),
    value: option.value,
    disabled: option.disabled,
  }));

  return (
    <BDSelect
      label={labelHidden ? undefined : label}
      aria-label={labelHidden ? label : undefined}
      value={value}
      onOptionChange={(nextValue) => onChange && onChange(nextValue)}
      options={mappedOptions}
      description={helpText}
      {...rest}
    />
  );
};

export const Checkbox: React.FC<any> = ({ label, checked, onChange, helpText, ...rest }) => (
  <BDCheckbox
    label={label}
    checked={checked}
    onChange={(event) => onChange && onChange(event.target.checked)}
    description={helpText}
    {...rest}
  />
);

export const RadioButton: React.FC<any> = ({ label, checked, onChange, ...rest }) => (
  <BDRadio
    label={label}
    checked={checked}
    onChange={(event) => onChange && onChange(event.target.checked)}
    {...rest}
  />
);

export const ProgressBar: React.FC<any> = ({ progress }) => (
  <BDProgressBar percent={progress} />
);

export const Toast: React.FC<any> = ({ content, error, onDismiss }) => (
  <BDBox
    style={{
      padding: "0.75rem 1rem",
      borderRadius: "6px",
      backgroundColor: error ? "#ffebee" : "#e3f2fd",
      borderLeft: `4px solid ${error ? "#c62828" : "#1565c0"}`,
      marginBottom: "1rem",
    }}
  >
    <Flex justifyContent="space-between" alignItems="center" flexGap="1rem">
      <BDText>{content}</BDText>
      {onDismiss && (
        <BDButton variant="subtle" iconOnly={<CloseIcon />} onClick={onDismiss} />
      )}
    </Flex>
  </BDBox>
);

export const Frame: React.FC<any> = ({ children }) => <>{children}</>;

export const FormLayout: React.FC<any> & { Group: React.FC<any> } = ({ children }) => (
  <Flex flexDirection="column" flexGap="1rem">{children}</Flex>
);

FormLayout.Group = ({ children }: any) => (
  <Flex flexDirection="row" flexGap="1rem" flexWrap="wrap">{children}</Flex>
);

export const DataTable: React.FC<any> = ({ headings, rows }) => (
  <BDBox style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {headings.map((heading: string, index: number) => (
            <th
              key={`heading-${index}`}
              style={{
                textAlign: "left",
                padding: "0.75rem",
                borderBottom: "1px solid #e0e0e0",
              }}
            >
              <Small>{heading}</Small>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row: React.ReactNode[], rowIndex: number) => (
          <tr key={`row-${rowIndex}`}>
            {row.map((cell, cellIndex) => (
              <td
                key={`cell-${rowIndex}-${cellIndex}`}
                style={{ padding: "0.75rem", borderBottom: "1px solid #f0f0f0" }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </BDBox>
);

export const ResourceList: React.FC<any> = ({ items, renderItem }) => (
  <BDBox>
    {items.map((item: any, index: number) => (
      <div key={item.id ?? index}>{renderItem(item)}</div>
    ))}
  </BDBox>
);

export const ResourceItem: React.FC<any> = ({ id, onClick, children }) => (
  <BDBox
    key={id}
    onClick={onClick}
    style={{
      padding: "0.75rem",
      borderBottom: "1px solid #f0f0f0",
      cursor: onClick ? "pointer" : "default",
    }}
  >
    {children}
  </BDBox>
);

export const Thumbnail: React.FC<any> = ({ source, alt, size }) => {
  const dimension = size === "small" ? 40 : 60;
  return (
    <img
      src={source}
      alt={alt}
      style={{
        width: dimension,
        height: dimension,
        objectFit: "cover",
        borderRadius: "6px",
      }}
    />
  );
};

export const EmptyState: React.FC<any> = ({ heading, children, action }) => (
  <BDBox style={{ textAlign: "center", padding: "2rem" }}>
    {heading && <H2>{heading}</H2>}
    {children && <BDText color="secondary">{children}</BDText>}
    {action && (
      <BDBox marginTop="medium">
        <BDButton variant="primary" onClick={action.onAction}>
          {action.content}
        </BDButton>
      </BDBox>
    )}
  </BDBox>
);

export const Icon: React.FC<any> = ({ source: Source, tone }) => {
  const color = tone === "success" ? "success" : tone === "critical" ? "danger" : "secondary";
  if (React.isValidElement(Source)) {
    return React.cloneElement(Source as React.ReactElement, { color });
  }
  if (typeof Source === "function") {
    return <Source color={color} />;
  }
  return null;
};

export const Tabs: React.FC<any> = ({ tabs, selected, onSelect }) => {
  const items = (tabs || []).map((tab: any) => ({
    id: tab.id || tab.content,
    title: tab.content,
    disabled: tab.disabled,
  }));

  const activeTab = items[selected]?.id;

  return (
    <BDTabs
      items={items}
      activeTab={activeTab}
      onTabClick={(tabId) => {
        const index = items.findIndex((item: any) => item.id === tabId);
        if (index >= 0 && onSelect) onSelect(index);
      }}
    />
  );
};

export type BadgeTone = "success" | "warning" | "critical" | "info" | "new" | "attention";
