import { MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import { useThemeStore } from '../stores/themeStore';

const ThemeToggle: React.FC = () => {
  const { mode, toggleMode } = useThemeStore();
  const isDark = mode === 'dark';

  return (
    <button
      onClick={toggleMode}
      className="relative inline-flex h-6 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:focus:ring-secondary-400 focus:ring-offset-white dark:focus:ring-offset-dark-900"
      style={{
        backgroundColor: isDark ? '#7c3aed' : '#0ea5e9',
      }}
    >
      <span className="sr-only">Toggle theme</span>
      <span
        className={`${
          isDark ? 'translate-x-6' : 'translate-x-1'
        } inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ease-in-out`}
      />
      <span className="absolute inset-0 flex items-center justify-between px-1.5">
        <SunIcon className={`h-3 w-3 text-white ${isDark ? 'opacity-40' : 'opacity-100'}`} />
        <MoonIcon className={`h-3 w-3 text-white ${isDark ? 'opacity-100' : 'opacity-40'}`} />
      </span>
    </button>
  );
};

export default ThemeToggle; 