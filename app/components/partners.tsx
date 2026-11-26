import { Form, useFetcher } from "react-router";
import type { partnersPage } from "../services/partners.server";

type Props = {
  data: Awaited<ReturnType<typeof partnersPage>>;
  partnerRole: "advertiser" | "publisher";
};

export function Partners({ data, partnerRole: role }: Props) {
  const fetcher = useFetcher<{
    error?: string;
    saved?: boolean;
    invitationUrl?: string;
  }>();
  const busy = fetcher.state !== "idle";

  const action = (partnerId: string, intent: string, label: string) => (
    <fetcher.Form method="post">
      <input type="hidden" name="partnerId" value={partnerId} />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="invitation" value={data.invitation} />
      <s-button type="submit" disabled={busy || data.shop.blocked}>
        {label}
      </s-button>
    </fetcher.Form>
  );

  return (
    <s-page heading={role === "advertiser" ? "Partners" : "Display partners"}>
      {(fetcher.data?.error || fetcher.data?.saved) && (
        <s-stack direction="block" gap="base">
          {fetcher.data?.error && (
            <s-banner tone="critical">{fetcher.data.error}</s-banner>
          )}
          {fetcher.data?.saved && <s-banner tone="success">Saved</s-banner>}
        </s-stack>
      )}

      <s-section heading="Allowed categories" padding="base">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {role === "advertiser"
              ? "Choose the niches of stores where your ads may appear."
              : "Choose the niches of advertisers you accept."}{" "}
            Both stores must select matching categories and agree to each
            direction.
          </s-paragraph>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="categories" />
            <s-stack direction="block" gap="base">
              {data.niches.map((n) => (
                <s-checkbox
                  key={`${n}-${data.categories.join()}`}
                  name="niches"
                  value={n}
                  label={n}
                  checked={data.categories.includes(n)}
                />
              ))}
              <s-button type="submit" disabled={busy || data.shop.blocked}>
                Save categories
              </s-button>
            </s-stack>
          </fetcher.Form>
        </s-stack>
      </s-section>

      <s-section heading="Your permissions" padding="base">
        <s-stack direction="block" gap="base">
          {!data.pairs.length && (
            <s-paragraph>No partners selected yet.</s-paragraph>
          )}
          {data.pairs.map((p) => (
            <s-box key={p.id} padding="base" border="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-heading>{p.partner.name}</s-heading>
                <s-paragraph>
                  {p.reason ??
                    "Permissions ready. Ads also require an available product and the publisher's app block."}
                </s-paragraph>
                <s-stack direction="inline" gap="base">
                  {action(
                    p.partner.id,
                    (role === "advertiser" ? p.selected : p.approved)
                      ? "revoke"
                      : "agree",
                    (role === "advertiser" ? p.selected : p.approved)
                      ? "Revoke permission"
                      : "Allow this direction",
                  )}
                  {action(
                    p.partner.id,
                    p.blocked ? "unblock" : "block",
                    p.blocked ? "Unblock" : "Block",
                  )}
                </s-stack>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Store catalogue" padding="base">
        <s-stack direction="block" gap="base">
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="catalogue" />
            <s-stack direction="block" gap="base">
              <s-checkbox
                key={String(data.shop.catalogConsent)}
                name="consent"
                value="true"
                label="I agree to list my store in the partner catalogue"
                checked={data.shop.catalogConsent}
              />
              <s-button type="submit" disabled={busy}>
                Save catalogue preference
              </s-button>
            </s-stack>
          </fetcher.Form>

          {!data.catalogue.length && (
            <s-paragraph>
              No stores are available. Share an invitation with a partner.
            </s-paragraph>
          )}

          {data.catalogue.map((s) => (
            <s-box key={s.id} padding="base" border="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <s-heading>{s.name}</s-heading>
                <s-paragraph>{s.niche ?? "Niche not selected"}</s-paragraph>

                {s.products.length > 0 && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 16,
                    }}
                  >
                    {s.products.map((product) => (
                      <s-box
                        key={product.id}
                        padding="base"
                        border="base"
                        borderRadius="base"
                      >
                        <s-stack direction="block" gap="small">
                          <s-image
                            src={product.imageUrl}
                            alt={product.title}
                            aspectRatio="4/3"
                            objectFit="contain"
                            loading="lazy"
                          />
                          <s-link href={product.productUrl} target="_blank">
                            {product.title}
                          </s-link>
                        </s-stack>
                      </s-box>
                    ))}
                  </div>
                )}

                {!s.products.length && (
                  <s-paragraph>
                    This partner has no products available for advertising yet.
                  </s-paragraph>
                )}

                {action(
                  s.id,
                  "agree",
                  role === "advertiser"
                    ? "Select publisher"
                    : "Approve advertiser",
                )}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Invite a partner" padding="base">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Invitations expire after seven days. They do not enable roles or
            approve advertising.
          </s-paragraph>

          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="invite" />
            <s-button type="submit" disabled={busy}>
              Create invitation link
            </s-button>
          </fetcher.Form>

          {fetcher.data?.invitationUrl && (
            <s-box padding="base" border="base" borderRadius="base">
              <s-paragraph>{fetcher.data.invitationUrl}</s-paragraph>
            </s-box>
          )}

          <Form method="get">
            <s-stack direction="block" gap="base">
              <s-text-field
                name="invite"
                label="Invitation code"
                value={data.invitation}
              />
              <s-button type="submit">Open invitation</s-button>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      {role === "publisher" && (
        <s-section heading="Add the advertising block" padding="base">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              In Online Store → Themes → Customize, add the Partner ads app
              block to a section that supports apps, then save the theme. The
              block is not enabled automatically. If no offers qualify it stays
              hidden.
            </s-paragraph>
            <s-link
              href={`https://${data.shop.domain}/admin/themes/current/editor`}
              target="_blank"
            >
              Open Theme Editor
            </s-link>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}