import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

function cx(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ScrollbarState = {
  height: number;
  top: number;
  visible: boolean;
};

export function Drawer(props: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

export function DrawerTrigger(props: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

export function DrawerPortal(props: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

export function DrawerClose(props: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

export function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      data-testid="drawer-overlay"
      className={cx("drawer-overlay", className)}
      {...props}
    />
  );
}

export function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className="drawer-content"
        {...props}
      >
        <div className={className}>
          <div className="grabber" aria-hidden="true" />
          {children}
        </div>
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

export function DrawerBody({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [scrollbar, setScrollbar] = React.useState<ScrollbarState>({
    height: 0,
    top: 0,
    visible: false,
  });

  const syncScrollbar = React.useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;

    const { clientHeight, scrollHeight, scrollTop } = body;
    const scrollable = scrollHeight > clientHeight + 1;
    if (!scrollable) {
      setScrollbar({ height: 0, top: 0, visible: false });
      return;
    }

    const height = Math.max(36, Math.round((clientHeight / scrollHeight) * clientHeight));
    const maxTop = clientHeight - height;
    const top = Math.round((scrollTop / (scrollHeight - clientHeight)) * maxTop);
    setScrollbar({ height, top, visible: true });
  }, []);

  React.useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    syncScrollbar();
    const initialSync = window.setTimeout(syncScrollbar, 0);
    body.addEventListener("scroll", syncScrollbar, { passive: true });
    window.addEventListener("resize", syncScrollbar);

    return () => {
      window.clearTimeout(initialSync);
      body.removeEventListener("scroll", syncScrollbar);
      window.removeEventListener("resize", syncScrollbar);
    };
  }, [children, syncScrollbar]);

  return (
    <div className="sheet-body-frame">
      <div ref={bodyRef} className={cx("sheet-body", className)} {...props}>
        {children}
      </div>
      {scrollbar.visible ? (
        <div className="sheet-scrollbar" aria-hidden="true">
          <div
            className="sheet-scrollbar-thumb"
            style={{
              height: scrollbar.height,
              transform: `translateY(${scrollbar.top}px)`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="drawer-header" className={cx("drawer-header", className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="drawer-footer" className={cx("drawer-footer", className)} {...props} />;
}

export function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cx("drawer-title", className)}
      {...props}
    />
  );
}

export function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cx("drawer-description", className)}
      {...props}
    />
  );
}
