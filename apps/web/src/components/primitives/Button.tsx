import type { ButtonHTMLAttributes } from 'react';

const VARIANT = {
  primary: 'bg-sage-600 text-surface active:bg-sage-700 font-medium',
  quiet: 'bg-transparent text-sage-700 active:bg-sage-100 font-medium',
  /** Destructive or money-changing, in the Manage zone (§5.2). */
  danger: 'bg-transparent text-clay active:bg-canvas font-medium',
} as const;

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANT }) {
  return (
    <button
      type={type}
      className={`min-h-11 rounded-button px-4 type-body disabled:opacity-50 ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}
