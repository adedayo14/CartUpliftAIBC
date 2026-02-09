
import type { NavLinkProps } from "@remix-run/react";
import { NavLink, useNavigate } from "@remix-run/react";
import { forwardRef, useCallback } from "react";

const AppNavLink = forwardRef<HTMLAnchorElement, NavLinkProps>((props, ref) => {
  const navigate = useNavigate();
  const { to, children, ...rest } = props;

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      navigate(to as string);
    },
    [navigate, to]
  );

  return (
    <NavLink ref={ref} to={to} {...rest} onClick={handleClick}>
      {children}
    </NavLink>
  );
});

AppNavLink.displayName = "AppNavLink";

export default AppNavLink;
