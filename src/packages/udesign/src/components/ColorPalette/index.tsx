import type { FC } from 'react';
import './index.less';

export interface ColorPaletteProps {
  className?: string;
}

const ColorPalette: FC<ColorPaletteProps> = ({ className }) => {
  const colorGroups = [
    {
      title: '品牌色 Brand',
      colors: [
        { name: 'brand-1', var: '--brand-1' },
        { name: 'brand-2', var: '--brand-2' },
        { name: 'brand-3', var: '--brand-3' },
        { name: 'brand-4', var: '--brand-4' },
        { name: 'brand-5', var: '--brand-5' },
        { name: 'brand-6', var: '--brand-6' },
        { name: 'brand-7', var: '--brand-7' },
        { name: 'brand-8', var: '--brand-8' },
        { name: 'brand-9', var: '--brand-9' },
        { name: 'brand-10', var: '--brand-10' },
      ],
    },
    {
      title: '成功色 Success',
      colors: [
        { name: 'success-1', var: '--success-1' },
        { name: 'success-2', var: '--success-2' },
        { name: 'success-3', var: '--success-3' },
        { name: 'success-4', var: '--success-4' },
        { name: 'success-5', var: '--success-5' },
        { name: 'success-6', var: '--success-6' },
        { name: 'success-7', var: '--success-7' },
        { name: 'success-8', var: '--success-8' },
        { name: 'success-9', var: '--success-9' },
        { name: 'success-10', var: '--success-10' },
      ],
    },
    {
      title: '警告色 Warning',
      colors: [
        { name: 'warning-1', var: '--warning-1' },
        { name: 'warning-2', var: '--warning-2' },
        { name: 'warning-3', var: '--warning-3' },
        { name: 'warning-4', var: '--warning-4' },
        { name: 'warning-5', var: '--warning-5' },
        { name: 'warning-6', var: '--warning-6' },
        { name: 'warning-7', var: '--warning-7' },
        { name: 'warning-8', var: '--warning-8' },
        { name: 'warning-9', var: '--warning-9' },
        { name: 'warning-10', var: '--warning-10' },
      ],
    },
    {
      title: '错误色 Error',
      colors: [
        { name: 'error-1', var: '--error-1' },
        { name: 'error-2', var: '--error-2' },
        { name: 'error-3', var: '--error-3' },
        { name: 'error-4', var: '--error-4' },
        { name: 'error-5', var: '--error-5' },
        { name: 'error-6', var: '--error-6' },
        { name: 'error-7', var: '--error-7' },
        { name: 'error-8', var: '--error-8' },
        { name: 'error-9', var: '--error-9' },
        { name: 'error-10', var: '--error-10' },
      ],
    },
    {
      title: '信息色 Info',
      colors: [
        { name: 'info-1', var: '--info-1' },
        { name: 'info-2', var: '--info-2' },
        { name: 'info-3', var: '--info-3' },
        { name: 'info-4', var: '--info-4' },
        { name: 'info-5', var: '--info-5' },
        { name: 'info-6', var: '--info-6' },
        { name: 'info-7', var: '--info-7' },
        { name: 'info-8', var: '--info-8' },
        { name: 'info-9', var: '--info-9' },
        { name: 'info-10', var: '--info-10' },
      ],
    },
    {
      title: '中性色 Neutral',
      colors: [
        { name: 'neutral-1', var: '--neutral-1' },
        { name: 'neutral-2', var: '--neutral-2' },
        { name: 'neutral-3', var: '--neutral-3' },
        { name: 'neutral-4', var: '--neutral-4' },
        { name: 'neutral-5', var: '--neutral-5' },
        { name: 'neutral-6', var: '--neutral-6' },
        { name: 'neutral-7', var: '--neutral-7' },
        { name: 'neutral-8', var: '--neutral-8' },
        { name: 'neutral-9', var: '--neutral-9' },
        { name: 'neutral-10', var: '--neutral-10' },
        { name: 'neutral-11', var: '--neutral-11' },
        { name: 'neutral-12', var: '--neutral-12' },
      ],
    },
  ];

  return (
    <div className={`color-palette ${className || ''}`}>
      {colorGroups.map((group) => (
        <div key={group.title} className="color-group">
          <h3 className="color-group__title">{group.title}</h3>
          <div className="color-group__grid">
            {group.colors.map((color) => (
              <div key={color.name} className="color-swatch">
                <div
                  className="color-swatch__preview"
                  style={{ backgroundColor: `var(${color.var})` }}
                />
                <div className="color-swatch__info">
                  <div className="color-swatch__name">{color.name}</div>
                  <div className="color-swatch__var">{color.var}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ColorPalette;
