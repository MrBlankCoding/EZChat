import React from 'react';

interface AvatarProps {
  className?: string;
}

interface AvatarImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  className?: string;
}

interface AvatarFallbackProps {
  className?: string;
  children: React.ReactNode;
}

export const Avatar: React.FC<AvatarProps & React.HTMLAttributes<HTMLDivElement>> = ({ 
  className = '', 
  ...props 
}) => {
  return (
    <div 
      className={`relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full ${className}`} 
      {...props}
    />
  );
};

export const AvatarImage: React.FC<AvatarImageProps> = ({ 
  className = '', 
  alt = '', 
  ...props 
}) => {
  return (
    <img
      className={`aspect-square h-full w-full object-cover ${className}`}
      alt={alt}
      {...props}
    />
  );
};

export const AvatarFallback: React.FC<AvatarFallbackProps & React.HTMLAttributes<HTMLDivElement>> = ({ 
  className = '', 
  children,
  ...props
}) => {
  return (
    <div
      className={`flex h-full w-full items-center justify-center rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export default Avatar; 