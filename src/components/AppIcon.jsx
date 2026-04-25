import React from 'react';
import appIconUrl from '../../icon/icon.png';

const AppIcon = ({ className = '', alt = 'GeoGebra 图标', decorative = false, ...props }) => (
  <img
    src={appIconUrl}
    alt={decorative ? '' : alt}
    aria-hidden={decorative ? 'true' : undefined}
    className={['app-icon-image', className].filter(Boolean).join(' ')}
    {...props}
  />
);

export default AppIcon;
