import { Box, Typography } from "@mui/material";
import { valueOf, type PropMeta } from "./deviceProps";

/** 概览/详情共用的键值表 */
export default function PropTable({
  items,
  props,
}: {
  items: PropMeta[];
  props: Record<string, string>;
}) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "background.paper",
      }}
    >
      {items.map((meta, i) => {
        const val = valueOf(props, meta.key);
        return (
          <Box
            key={meta.key}
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "minmax(140px, 32%) 1fr" },
              columnGap: 2,
              rowGap: 0.25,
              px: 1.75,
              py: 1.1,
              borderBottom: i === items.length - 1 ? 0 : 1,
              borderColor: "divider",
              bgcolor: i % 2 === 0 ? "transparent" : "rgba(13, 122, 111, 0.04)",
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600}>
                {meta.zh === meta.key ? meta.key : meta.zh}
              </Typography>
              {meta.zh !== meta.key ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontFamily: "IBM Plex Mono, monospace", wordBreak: "break-all" }}
                >
                  {meta.key}
                </Typography>
              ) : null}
            </Box>
            <Typography
              variant="body2"
              sx={{
                alignSelf: { sm: "center" },
                wordBreak: "break-all",
                color: val ? "text.primary" : "text.disabled",
                fontFamily:
                  /serial|abi|sdk|id|fingerprint/i.test(meta.key)
                    ? "IBM Plex Mono, monospace"
                    : "inherit",
                fontSize:
                  /serial|abi|sdk|id|fingerprint/i.test(meta.key)
                    ? "0.8rem"
                    : undefined,
              }}
            >
              {val || "—"}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
