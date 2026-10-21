import Image from "next/image";
import { Link } from "@/i18n/navigation";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={className} aria-label="JWC Beverage Planet">
      <Image
        src="/brand/jwc-logo-black.png"
        alt="JWC"
        width={650}
        height={227}
        priority
        className="h-7 w-auto"
      />
    </Link>
  );
}
