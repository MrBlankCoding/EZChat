import React, { useState, ReactNode } from 'react';

interface TooltipProviderProps {
  children: ReactNode;
  delayDuration?: number;
}

export function TooltipProvider({ children, delayDuration = 300 }: TooltipProviderProps) {
  return <>{children}</>;
}

interface TooltipProps {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface TooltipContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  delayDuration?: number;
}

const TooltipContext = React.createContext<TooltipContextValue | undefined>(undefined);

export function Tooltip({ 
  children, 
  open, 
  defaultOpen = false, 
  onOpenChange 
}: TooltipProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  const openState = open !== undefined ? open : isOpen;
  const setOpenState = (value: boolean) => {
    setIsOpen(value);
    onOpenChange?.(value);
  };

  return (
    <TooltipContext.Provider value={{ open: openState, setOpen: setOpenState }}>
      {children}
    </TooltipContext.Provider>
  );
}

interface TriggerProps {
  children: ReactNode;
  asChild?: boolean;
}

export function TooltipTrigger({ children, asChild = false }: TriggerProps) {
  const context = React.useContext(TooltipContext);
  
  if (!context) {
    throw new Error('TooltipTrigger must be used within a Tooltip');
  }
  
  return (
    <div
      onMouseEnter={() => context.setOpen(true)}
      onMouseLeave={() => context.setOpen(false)}
      className="inline-block"
    >
      {children}
    </div>
  );
}

interface ContentProps {
  children: ReactNode;
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
}

export function TooltipContent({ 
  children, 
  className = '', 
  side = 'top', 
  align = 'center', 
  sideOffset = 8
}: ContentProps) {
  const context = React.useContext(TooltipContext);
  
  if (!context) {
    throw new Error('TooltipContent must be used within a Tooltip');
  }
  
  if (!context.open) {
    return null;
  }
  
  const positions = {
    top: {
      start: 'bottom-full left-0 mb-2',
      center: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
      end: 'bottom-full right-0 mb-2',
    },
    right: {
      start: 'left-full top-0 ml-2',
      center: 'left-full top-1/2 -translate-y-1/2 ml-2',
      end: 'left-full bottom-0 ml-2',
    },
    bottom: {
      start: 'top-full left-0 mt-2',
      center: 'top-full left-1/2 -translate-x-1/2 mt-2',
      end: 'top-full right-0 mt-2',
    },
    left: {
      start: 'right-full top-0 mr-2',
      center: 'right-full top-1/2 -translate-y-1/2 mr-2',
      end: 'right-full bottom-0 mr-2',
    },
  };
  
  const positionClass = positions[side][align];
  
  return (
    <div
      className={`absolute z-50 max-w-xs rounded-md bg-black px-3 py-1.5 text-xs text-white shadow-lg ${positionClass} ${className}`}
      role="tooltip"
    >
      {children}
      <div className="tooltip-arrow" />
    </div>
  );
}

export default Tooltip; 