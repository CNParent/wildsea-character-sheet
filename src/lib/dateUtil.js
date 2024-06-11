export default {
    shortDate: (dte = new Date()) => {
        let dd = dte.getDate().toString();
        if(dd.length == 1) dd = `0${dd}`;

        let mm = (dte.getMonth() + 1).toString();
        if(mm.length == 1) mm = `0${mm}`;

        let yyyy = dte.getFullYear();
        while(yyyy.length < 4) yyyy = `0${yyyy}`;

        return `${yyyy}-${mm}-${dd}`
    }
}