import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

const REPO = "https://github.com/Permutation-Limited/ank-pwr-bt";

export function Footer() {
  return (
    <Box component="footer" sx={{
      maxWidth: 920, mx: "auto", px: 2.5, pt: 2.5, pb: 4, mt: "auto",
      borderTop: 1, borderColor: "divider", textAlign: "center",
    }}>
      <Typography variant="caption" component="p" color="text.secondary">
        © 2026 Permutation Limited · <Link href={REPO} color="inherit">Source</Link>
        {" · "}<Link href={`${REPO}/blob/main/LICENSE`} color="inherit">MIT License</Link>
      </Typography>
      <Typography variant="caption" component="p" color="text.secondary">
        Independent project, not affiliated with, endorsed by or sponsored by Anker Innovations.
        Anker and SOLIX are trademarks of Anker Innovations Limited. Use at your own risk.
      </Typography>
    </Box>
  );
}
