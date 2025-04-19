import React, { createContext, useContext, useState } from 'react';
import { Menu } from '@headlessui/react';

type DropdownMenuContextType = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const DropdownMenuContext = createContext<DropdownMenuContextType | undefined>(undefined);

function useDropdownMenuContext() {
  const context = useContext(DropdownMenuContext);
  if (context === undefined) {
    throw new Error('useDropdownMenuContext must be used within a DropdownMenu');
  }
  return context;
}

interface DropdownMenuProps {
  children: React.ReactNode;
}

export function DropdownMenu({ children }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <Menu as="div" className="relative inline-block text-left">
        {children}
      </Menu>
    </DropdownMenuContext.Provider>
  );
}

interface DropdownMenuTriggerProps {
  children: React.ReactNode;
  className?: string;
}

export function DropdownMenuTrigger({ children, className = '' }: DropdownMenuTriggerProps) {
  return (
    <Menu.Button className={`inline-flex justify-center ${className}`}>
      {children}
    </Menu.Button>
  );
}

interface DropdownMenuContentProps {
  children: React.ReactNode;
  className?: string;
  align?: 'start' | 'end' | 'center';
  sideOffset?: number;
}

export function DropdownMenuContent({
  children,
  className = '',
  align = 'center',
  sideOffset = 4,
}: DropdownMenuContentProps) {
  const alignClasses = {
    start: 'left-0',
    center: 'left-1/2 -translate-x-1/2',
    end: 'right-0',
  };

  return (
    <Menu.Items
      className={`absolute z-50 mt-${sideOffset} w-44 rounded-md border border-gray-100 bg-white p-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:border-gray-800 dark:bg-dark-800 dark:ring-white dark:ring-opacity-10 ${alignClasses[align]} ${className}`}
    >
      {children}
    </Menu.Items>
  );
}

interface DropdownMenuItemProps {
  children: React.ReactNode;
  className?: string;
  onSelect?: () => void;
  disabled?: boolean;
}

export function DropdownMenuItem({
  children,
  className = '',
  onSelect,
  disabled = false,
}: DropdownMenuItemProps) {
  return (
    <Menu.Item disabled={disabled}>
      {({ active }) => (
        <button
          onClick={onSelect}
          className={`${
            active ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'
          } group flex w-full items-center rounded-md px-3 py-2 text-sm ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`}
          disabled={disabled}
        >
          {children}
        </button>
      )}
    </Menu.Item>
  );
}

export default DropdownMenu; 