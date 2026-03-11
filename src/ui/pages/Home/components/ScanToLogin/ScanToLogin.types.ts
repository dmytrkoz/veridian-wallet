interface ScanToLoginProps {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
}

interface ScanToLoginContent {
  subtitle: string;
  text: string;
}

export type { ScanToLoginProps, ScanToLoginContent };
