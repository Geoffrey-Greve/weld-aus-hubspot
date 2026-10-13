/**
 * checkout-confirmation - React island entry point.
 *
 * HubL module.html mounts:
 *   <div data-wa-module="checkout-confirmation" data-props="<json>"></div>
 *
 * Receipt data is read from sessionStorage (key: wa_checkout_session),
 * written there by the checkout-tunnel island before payment redirect.
 */

import { CheckoutConfirmation } from './CheckoutConfirmation'
import mountReactIsland from '@shared/mount'

mountReactIsland('checkout-confirmation', CheckoutConfirmation)
