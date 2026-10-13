/**
 * checkout-tunnel - React island entry point.
 *
 * HubL module.html mounts:
 *   <div data-wa-module="checkout-tunnel" data-props="<json>"></div>
 *
 * Props (CheckoutTunnelProps) are serialised from HubL into data-props.
 * See theme/modules/checkout-tunnel.module/module.html for the HubL source.
 */

import { CheckoutTunnel } from './CheckoutTunnel'
import mountReactIsland from '@shared/mount'

mountReactIsland('checkout-tunnel', CheckoutTunnel)
