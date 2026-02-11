# Privacy Policy Implementation

This document describes the implementation of the Privacy Policy page for D2ArmorPicker.

## Files Added

### Component Files

- `src/app/components/authenticated-v2/subpages/privacy-policy-page/privacy-policy-page.component.ts` - Component logic
- `src/app/components/authenticated-v2/subpages/privacy-policy-page/privacy-policy-page.component.html` - Privacy policy content and structure
- `src/app/components/authenticated-v2/subpages/privacy-policy-page/privacy-policy-page.component.scss` - Styling for the privacy policy page
- `src/app/components/authenticated-v2/subpages/privacy-policy-page/privacy-policy-page.component.spec.ts` - Unit tests

## Files Modified

### Routing Configuration

- `src/app/app.module.ts` - Added privacy policy route and component declaration

### Navigation

- `src/app/components/authenticated-v2/app-v2-core/app-v2-core.component.ts` - Added privacy policy link to navigation

### Login Page

- `src/app/components/login/login.component.html` - Added privacy policy link in login footer
- `src/app/components/login/login.component.css` - Added styles for privacy policy link

### Account Page

- `src/app/components/authenticated-v2/subpages/account-config-page/account-config-page.component.html` - Added Privacy & Legal section

## Data Collection Information

The privacy policy covers the following types of data collection:

### Personal Information

- **Bungie Usernames**: Collected when users authenticate with Bungie accounts
- **IP Addresses**: Collected automatically for security and analytics purposes
- **Usage Data**: Information about user interactions with the service

### Game Data

- **Destiny 2 Character Information**: Retrieved through Bungie API
- **Armor Pieces and Stats**: Used for optimization calculations
- **Account Preferences**: Stored locally for user experience

## Routes

The privacy policy is accessible through:

- `/privacy-policy` - Main privacy policy page (requires authentication)
- Direct link from login page (opens in new tab)
- Navigation menu item "Privacy Policy"
- Account page "Privacy & Legal" section

## Styling

The privacy policy page includes:

- Responsive design for mobile and desktop
- Dark theme support
- Clean, readable typography
- Organized sections with clear headings
- Proper spacing and visual hierarchy

## Legal Compliance

The privacy policy addresses:

- GDPR compliance considerations
- User rights and data handling
- Third-party services (Bungie API)
- Data retention and security
- Contact information for privacy inquiries

## Testing

Unit tests verify:

- Component creation and initialization
- Presence of required content sections
- Proper rendering of privacy policy text

## Future Considerations

- Regular updates as features are added
- Localization for multiple languages
- Integration with consent management
- Analytics and tracking disclosures
