import {useEffect} from 'react'
import {useTheme} from '../context/ThemeContext'
import {Icon} from '../pages/redesign/RedesignShell'
export default function JuniorsThemeSwitch(){
 const theme=useTheme()
 useEffect(()=>{if(!theme)return;const meta=document.querySelector('meta[name=theme-color]');if(!meta)return;const previous=meta.content;meta.content=theme.dark?'#0b151c':'#f3f7f8';return()=>{meta.content=previous}},[theme?.dark])
 if(!theme)return null
 return <button type="button" className="juniors-theme-switch" role="switch" aria-checked={theme.dark} aria-label="Dark mode" onClick={theme.toggle}><Icon name={theme.dark?'moon':'sun'} size={18}/><span>{theme.dark?'Dark':'Light'}</span></button>
}
